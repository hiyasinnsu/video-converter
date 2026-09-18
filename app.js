// クライアントサイド動画軽量化・変換エンジン (app.js)

(function () {
  'use strict';

  // --- DOM要素 ---
  const videoInput = document.getElementById('videoInput');
  const dropzone = document.getElementById('dropzone');

  const uploadCard = document.getElementById('uploadCard');
  const settingsCard = document.getElementById('settingsCard');
  const progressCard = document.getElementById('progressCard');
  const resultCard = document.getElementById('resultCard');

  const sourceVideo = document.getElementById('sourceVideo');
  const renderCanvas = document.getElementById('renderCanvas');
  const resultVideo = document.getElementById('resultVideo');

  const origSizeEl = document.getElementById('origSize');
  const origResolutionEl = document.getElementById('origResolution');
  const origDurationEl = document.getElementById('origDuration');
  const origBitrateEl = document.getElementById('origBitrate');

  const targetWidthInput = document.getElementById('targetWidth');
  const targetHeightInput = document.getElementById('targetHeight');
  const aspectRatioLock = document.getElementById('aspectRatioLock');
  const presetButtons = document.querySelectorAll('.btn-preset');

  const bitrateInput = document.getElementById('bitrateInput');
  const bitrateSlider = document.getElementById('bitrateSlider');

  const keepAudioCheckbox = document.getElementById('keepAudio');
  const speedSelect = document.getElementById('speedSelect');

  const startBtn = document.getElementById('startBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const resetBtn = document.getElementById('resetBtn');
  const downloadLink = document.getElementById('downloadLink');

  const progressBarFill = document.getElementById('progressBarFill');
  const progressPercentage = document.getElementById('progressPercentage');
  const progressTime = document.getElementById('progressTime');

  const beforeSizeEl = document.getElementById('beforeSize');
  const afterSizeEl = document.getElementById('afterSize');
  const savingsPercentEl = document.getElementById('savingsPercent');

  const fileNameInput = document.getElementById('fileNameInput');
  const fileExtBadge = document.getElementById('fileExtBadge');
  const resultFileNameInput = document.getElementById('resultFileNameInput');
  const resultFileExtBadge = document.getElementById('resultFileExtBadge');

  // --- 状態管理 ---
  let originalFile = null;
  let originalVideoUrl = null;
  let originalWidth = 0;
  let originalHeight = 0;
  let originalDuration = 0;
  let originalAspectRatio = 1;

  let isConverting = false;
  let mediaRecorder = null;
  let conversion = null;
  let animFrameId = null;
  let videoCallbackId = null;
  let activeStream = null;
  let audioContext = null;
  let audioDestination = null;
  let audioSourceNode = null;
  let outputBlobUrl = null;
  let currentExtension = 'mp4';

  // --- ユーティリティ関数 ---
  function sanitizeFileName(name) {
    // OSで禁止されている文字 \ / : * ? " < > | を除去
    return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim();
  }

  function updateDownloadFileName() {
    let rawName = resultFileNameInput.value || fileNameInput.value || '';
    let sanitized = sanitizeFileName(rawName);
    if (!sanitized) {
      sanitized = 'compressed_video';
    }
    // ユーザーが手動で拡張子を入力した場合の二重拡張子（.mp4.mp4等）を防止
    sanitized = sanitized.replace(new RegExp(`\\.${currentExtension}$`, 'i'), '');
    sanitized = sanitized.replace(/[. ]+$/, '') || 'compressed_video';
    const finalName = `${sanitized}.${currentExtension}`;
    downloadLink.download = finalName;
  }

  function formatBytes(bytes, decimals = 1) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  function formatSeconds(seconds) {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  // 偶数化（エンコーダー要件）
  function makeEven(val) {
    return Math.max(2, Math.round(val / 2) * 2);
  }

  // サポートされているMIMEタイプを取得
  function getSupportedMimeType() {
    const candidateTypes = [
      'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
    for (const type of candidateTypes) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return '';
  }

  // --- ドラッグ＆ドロップ対応 ---
  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    }, false);
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files && files.length > 0 && files[0].type.startsWith('video/')) {
      handleFileSelected(files[0]);
    }
  });

  videoInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelected(e.target.files[0]);
    }
  });

  // --- ファイル読み込み処理 ---
  function handleFileSelected(file) {
    if (isConverting) return;
    originalFile = file;
    originalDuration = 0;
    sourceVideo.pause();
    sourceVideo.muted = true;
    resetPreviewSpeed(sourceVideo);
    clearActivePresets();

    // 前回のURLがあれば解放
    if (originalVideoUrl) {
      URL.revokeObjectURL(originalVideoUrl);
    }
    originalVideoUrl = URL.createObjectURL(file);
    sourceVideo.src = originalVideoUrl;


    origSizeEl.textContent = formatBytes(file.size);

    sourceVideo.onloadedmetadata = () => {
      originalWidth = sourceVideo.videoWidth;
      originalHeight = sourceVideo.videoHeight;
      originalDuration = sourceVideo.duration;
      if (!originalWidth || !originalHeight || !Number.isFinite(originalDuration) || originalDuration <= 0) {
        sourceVideo.onerror();
        return;
      }
      originalAspectRatio = originalWidth / originalHeight;

      origResolutionEl.textContent = `${originalWidth} × ${originalHeight}`;
      origDurationEl.textContent = formatSeconds(originalDuration);

      // 元動画の全体ビットレート（推定）
      const estimatedBps = Math.round((file.size * 8) / originalDuration);
      const estimatedKbps = Math.round(estimatedBps / 1000);
      origBitrateEl.textContent = `${estimatedKbps.toLocaleString()} kbps`;

      // 解像度の初期設定（短辺720px超なら720p推奨）
      if (Math.min(originalWidth, originalHeight) > 720) {
        applyPreset('720');
      } else {
        targetWidthInput.value = makeEven(originalWidth);
        targetHeightInput.value = makeEven(originalHeight);
      }

      // ビットレートの初期設定（元動画の半分程度、または2000kbpsを上限として推奨）
      let initialBitrate = Math.min(Math.round(estimatedKbps * 0.5), 2000);
      if (initialBitrate < 400) initialBitrate = 400;
      setBitrate(initialBitrate);

      // ファイル名の初期設定（元ファイル名 + _light）
      const defaultBaseName = file.name.replace(/\.[^/.]+$/, '') || 'video';
      const initialFileName = `${defaultBaseName}_light`;
      fileNameInput.value = initialFileName;
      resultFileNameInput.value = initialFileName;

      // 拡張子バッジの初期表示
      const mime = getSupportedMimeType();
      currentExtension = mime.includes('mp4') ? 'mp4' : 'webm';
      fileExtBadge.textContent = `.${currentExtension}`;
      resultFileExtBadge.textContent = `.${currentExtension}`;
      updateDownloadFileName();

      // UI切り替え
      uploadCard.style.display = 'none';
      settingsCard.style.display = 'block';
      resultCard.style.display = 'none';
      progressCard.style.display = 'none';
    };
    sourceVideo.onerror = () => {
      originalDuration = 0;
      settingsCard.style.display = 'none';
      uploadCard.style.display = 'block';
      videoInput.value = '';
      alert('動画を読み込めません。ブラウザで再生できる動画を選択してください。');
    };
    sourceVideo.load();
  }

  function resetPreviewSpeed(video) {
    video.playbackRate = 1;
    document.querySelectorAll(`.speed-pill-group[data-target="${video.id}"] .btn-speed-pill`).forEach(pill => {
      pill.classList.toggle('active', Number(pill.dataset.speed) === 1);
    });
  }

  // --- ファイル名入力連動 ---
  fileNameInput.addEventListener('input', () => {
    resultFileNameInput.value = fileNameInput.value;
    updateDownloadFileName();
  });

  resultFileNameInput.addEventListener('input', () => {
    fileNameInput.value = resultFileNameInput.value;
    updateDownloadFileName();
  });

  // --- プレビュー再生速度コントロール ---
  const speedPills = document.querySelectorAll('.btn-speed-pill');
  speedPills.forEach(pill => {
    pill.addEventListener('click', () => {
      const parentGroup = pill.closest('.speed-pill-group');
      const targetId = parentGroup ? parentGroup.dataset.target : null;
      const targetVideo = targetId ? document.getElementById(targetId) : null;
      const speed = parseFloat(pill.dataset.speed);

      if (targetVideo && !isNaN(speed)) {
        targetVideo.playbackRate = speed;
        // 同一グループ内のアクティブクラス切り替え
        parentGroup.querySelectorAll('.btn-speed-pill').forEach(btn => btn.classList.remove('active'));
        pill.classList.add('active');
      }
    });
  });

  // --- 解像度パラメータ連動 ---
  targetWidthInput.addEventListener('input', () => {
    let width = parseInt(targetWidthInput.value, 10);
    if (isNaN(width) || width <= 0) return;
    if (aspectRatioLock.checked && originalAspectRatio > 0) {
      const height = makeEven(width / originalAspectRatio);
      targetHeightInput.value = height;
    }
    clearActivePresets();
  });

  targetHeightInput.addEventListener('input', () => {
    let height = parseInt(targetHeightInput.value, 10);
    if (isNaN(height) || height <= 0) return;
    if (aspectRatioLock.checked && originalAspectRatio > 0) {
      const width = makeEven(height * originalAspectRatio);
      targetWidthInput.value = width;
    }
    clearActivePresets();
  });

  function clearActivePresets() {
    presetButtons.forEach(btn => btn.classList.remove('active'));
  }

  function applyPreset(preset) {
    clearActivePresets();
    const isLandscape = originalWidth >= originalHeight;

    if (preset === '1080') {
      if (isLandscape) {
        targetWidthInput.value = makeEven(1080 * originalAspectRatio);
        targetHeightInput.value = 1080;
      } else {
        targetWidthInput.value = 1080;
        targetHeightInput.value = makeEven(1080 / originalAspectRatio);
      }
    } else if (preset === '720') {
      if (isLandscape) {
        targetWidthInput.value = makeEven(720 * originalAspectRatio);
        targetHeightInput.value = 720;
      } else {
        targetWidthInput.value = 720;
        targetHeightInput.value = makeEven(720 / originalAspectRatio);
      }
    } else if (preset === '480') {
      if (isLandscape) {
        targetWidthInput.value = makeEven(480 * originalAspectRatio);
        targetHeightInput.value = 480;
      } else {
        targetWidthInput.value = 480;
        targetHeightInput.value = makeEven(480 / originalAspectRatio);
      }
    } else if (preset === '360') {
      if (isLandscape) {
        targetWidthInput.value = makeEven(360 * originalAspectRatio);
        targetHeightInput.value = 360;
      } else {
        targetWidthInput.value = 360;
        targetHeightInput.value = makeEven(360 / originalAspectRatio);
      }
    } else if (preset === 'half') {
      targetWidthInput.value = makeEven(originalWidth * 0.5);
      targetHeightInput.value = makeEven(originalHeight * 0.5);
    }

    const clickedBtn = document.querySelector(`.btn-preset[data-preset="${preset}"]`);
    if (clickedBtn) clickedBtn.classList.add('active');
  }

  presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      applyPreset(btn.dataset.preset);
    });
  });

  // --- ビットレート連動 ---
  function setBitrate(kbps) {
    bitrateInput.value = kbps;
    bitrateSlider.value = Math.min(kbps, parseInt(bitrateSlider.max, 10));
  }

  bitrateSlider.addEventListener('input', () => {
    bitrateInput.value = bitrateSlider.value;
  });

  bitrateInput.addEventListener('input', () => {
    const val = parseInt(bitrateInput.value, 10);
    if (!isNaN(val)) {
      bitrateSlider.value = Math.min(val, parseInt(bitrateSlider.max, 10));
    }
  });

  // 読み込み・シーク待ちをキャンセル時にも解除する。
  function waitForVideo(eventName, signal) {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        sourceVideo.removeEventListener(eventName, done);
        sourceVideo.removeEventListener('error', failed);
        signal.removeEventListener('abort', failed);
      };
      const done = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error('動画の準備が中断されたか、読み込みに失敗しました。')); };
      const timer = setTimeout(failed, 15000);
      sourceVideo.addEventListener(eventName, done, { once: true });
      sourceVideo.addEventListener('error', failed, { once: true });
      signal.addEventListener('abort', failed, { once: true });
    });
  }

  // --- 変換処理（標準Web API方式） ---
  startBtn.addEventListener('click', async () => {
    if (isConverting || !originalFile || !originalDuration) return;
    const width = Number(targetWidthInput.value);
    const height = Number(targetHeightInput.value);
    const kbps = Number(bitrateInput.value);
    const playbackSpeed = Number(speedSelect.value);
    if (![width, height].every(v => Number.isInteger(v) && v >= 2 && v <= 3840) ||
        !Number.isFinite(kbps) || kbps < 100 || kbps > 20000 ||
        ![0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].includes(playbackSpeed)) {
      alert('解像度は2〜3840pxの整数、ビットレートは100〜20000kbpsで指定してください。');
      return;
    }
    const mimeType = getSupportedMimeType();
    if (!mimeType || typeof renderCanvas.captureStream !== 'function') {
      alert('このブラウザは動画変換に必要な録画機能に対応していません。');
      return;
    }
    const targetWidth = makeEven(width);
    const targetHeight = makeEven(height);
    targetWidthInput.value = targetWidth;
    targetHeightInput.value = targetHeight;
    const keepAudio = keepAudioCheckbox.checked && playbackSpeed >= 0.3;
    // スロー時はサイズ増加を抑える。実際の出力サイズはエンコーダー依存。
    const effectiveBitrateBps = playbackSpeed < 1
      ? Math.max(150000, Math.round(kbps * 1000 * playbackSpeed)) : kbps * 1000;
    const job = { chunks: [], cancelled: false, controller: new AbortController(), preview: sourceVideo.parentElement };
    conversion = job;
    isConverting = true;
    settingsCard.style.display = 'none';
    progressCard.style.display = 'block';
    resultCard.style.display = 'none';
    progressBarFill.style.width = '0%';
    progressPercentage.textContent = '0%';
    progressTime.textContent = `00:00 / ${formatSeconds(originalDuration / playbackSpeed)}`;
    // 表示中の動画を使い、非表示動画へのフレームコールバック抑制を避ける。
    progressCard.prepend(job.preview);
    sourceVideo.controls = false;
    sourceVideo.pause();

    try {
      renderCanvas.width = targetWidth;
      renderCanvas.height = targetHeight;
      const ctx = renderCanvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('描画領域を準備できませんでした。');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      activeStream = renderCanvas.captureStream(0);
      let videoTrack = activeStream.getVideoTracks()[0];
      if (!videoTrack || typeof videoTrack.requestFrame !== 'function') {
        activeStream.getTracks().forEach(track => track.stop());
        activeStream = renderCanvas.captureStream(30);
        videoTrack = null;
      }
      if (keepAudio) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) throw new Error('音声の取得に対応していません。「音声を残す」をOFFにしてください。');
        if (!audioContext) audioContext = new AudioContextClass();
        if (!audioSourceNode) audioSourceNode = audioContext.createMediaElementSource(sourceVideo);
        audioSourceNode.disconnect();
        audioDestination = audioContext.createMediaStreamDestination();
        audioSourceNode.connect(audioDestination);
        audioDestination.stream.getAudioTracks().forEach(track => activeStream.addTrack(track));
        await audioContext.resume();
        if (job.cancelled) return;
        if (audioContext.state !== 'running') throw new Error('音声処理を開始できませんでした。');
      }
      sourceVideo.muted = !keepAudio;
      sourceVideo.playbackRate = playbackSpeed;
      if (sourceVideo.seeking || sourceVideo.currentTime !== 0) {
        const seeked = waitForVideo('seeked', job.controller.signal);
        sourceVideo.currentTime = 0;
        await seeked;
      }
      if (job.cancelled) return;
      if (sourceVideo.readyState < 2) await waitForVideo('loadeddata', job.controller.signal);
      if (job.cancelled) return;
      ctx.drawImage(sourceVideo, 0, 0, targetWidth, targetHeight);
      try {
        mediaRecorder = new MediaRecorder(activeStream, { mimeType, videoBitsPerSecond: effectiveBitrateBps });
      } catch {
        mediaRecorder = new MediaRecorder(activeStream, { videoBitsPerSecond: effectiveBitrateBps });
      }
      const recorder = mediaRecorder;
      recorder.ondataavailable = event => {
        if (!job.cancelled && event.data.size > 0) job.chunks.push(event.data);
      };
      recorder.onstop = () => {
        if (conversion !== job) return;
        const actualMime = recorder.mimeType || job.chunks[0]?.type;
        const succeeded = !job.cancelled && job.chunks.length > 0 &&
          /video\/(mp4|webm)/i.test(actualMime || '');
        cleanupConversion();
        if (succeeded) finishConversion(actualMime, job.chunks);
        else {
          settingsCard.style.display = 'block';
          if (!job.cancelled) alert('録画データを生成できませんでした。設定を変更して再試行してください。');
        }
        job.chunks.length = 0;
      };
      recorder.onerror = () => {
        if (conversion === job) failConversion(new Error('録画中にエラーが発生しました。'));
      };
      sourceVideo.onerror = () => failConversion(new Error('動画の再生中にエラーが発生しました。'));
      sourceVideo.onended = stopConversion;
      const startedAt = performance.now();
      function renderLoop() {
        if (conversion !== job || job.cancelled) return;
        try {
          ctx.drawImage(sourceVideo, 0, 0, targetWidth, targetHeight);
          // requestFrame は要求フラグであり、連続呼び出しで複数コマは生成できない。
          if (videoTrack) videoTrack.requestFrame();
          const pct = Math.min(99, Math.round(sourceVideo.currentTime / originalDuration * 100));
          progressBarFill.style.width = `${pct}%`;
          progressPercentage.textContent = `${pct}%`;
          progressTime.textContent = `${formatSeconds((performance.now() - startedAt) / 1000)} / ${formatSeconds(originalDuration / playbackSpeed)}`;
          if ('requestVideoFrameCallback' in sourceVideo) videoCallbackId = sourceVideo.requestVideoFrameCallback(renderLoop);
          else animFrameId = requestAnimationFrame(renderLoop);
        } catch (error) { failConversion(error); }
      }
      recorder.start(500);
      renderLoop();
      await sourceVideo.play();
    } catch (error) {
      if (conversion === job && !job.cancelled) failConversion(error);
    }
  });

  function releasePlayback() {
    sourceVideo.onended = null;
    sourceVideo.onerror = null;
    sourceVideo.pause();
    sourceVideo.muted = true;
    if (animFrameId !== null) cancelAnimationFrame(animFrameId);
    if (videoCallbackId !== null && 'cancelVideoFrameCallback' in sourceVideo) sourceVideo.cancelVideoFrameCallback(videoCallbackId);
    animFrameId = videoCallbackId = null;
  }

  function cleanupConversion() {
    releasePlayback();
    if (activeStream) activeStream.getTracks().forEach(track => track.stop());
    if (audioSourceNode) audioSourceNode.disconnect();
    if (audioDestination) audioDestination.stream.getTracks().forEach(track => track.stop());
    audioDestination = activeStream = mediaRecorder = null;
    if (conversion) {
      settingsCard.insertBefore(conversion.preview, settingsCard.querySelector('.preview-speed-control'));
      conversion.controller.abort();
    }
    sourceVideo.controls = true;
    resetPreviewSpeed(sourceVideo);
    conversion = null;
    isConverting = false;
    progressCard.style.display = 'none';
  }

  function stopConversion() {
    if (!conversion) return;
    releasePlayback();
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  }

  function cancelConversion() {
    if (!conversion) return;
    conversion.cancelled = true;
    conversion.chunks.length = 0;
    conversion.controller.abort();
    stopConversion();
    cleanupConversion();
    settingsCard.style.display = 'block';
  }

  function failConversion(error) {
    console.error(error);
    cancelConversion();
    alert(error.message || '変換に失敗しました。設定を変更して再試行してください。');
  }

  cancelBtn.addEventListener('click', cancelConversion);

  // 変換完了時の処理
  function finishConversion(mimeType, recordedChunks) {
    progressBarFill.style.width = '100%';
    progressPercentage.textContent = '100%';

    const isMp4 = mimeType.includes('mp4');
    const extension = isMp4 ? 'mp4' : 'webm';
    const outputBlob = new Blob(recordedChunks, { type: mimeType });

    if (outputBlobUrl) {
      URL.revokeObjectURL(outputBlobUrl);
    }
    outputBlobUrl = URL.createObjectURL(outputBlob);

    // サイズ比較
    const originalBytes = originalFile.size;
    const resultBytes = outputBlob.size;
    beforeSizeEl.textContent = formatBytes(originalBytes);
    afterSizeEl.textContent = formatBytes(resultBytes);

    let savingsPercent = 0;
    if (originalBytes > 0) {
      savingsPercent = ((1 - (resultBytes / originalBytes)) * 100).toFixed(1);
    }

    if (savingsPercent > 0) {
      savingsPercentEl.textContent = `${savingsPercent}%`;
    } else {
      savingsPercentEl.textContent = `${Math.abs(Number(savingsPercent)).toFixed(1)}% 増加（設定や形式によりサイズは増えることがあります）`;
    }

    // 結果プレビュー
    resetPreviewSpeed(resultVideo);
    resultVideo.src = outputBlobUrl;

    // ダウンロードボタン
    currentExtension = extension;
    fileExtBadge.textContent = `.${currentExtension}`;
    resultFileExtBadge.textContent = `.${currentExtension}`;
    downloadLink.href = outputBlobUrl;
    
    updateDownloadFileName();

    // 画面切り替え
    progressCard.style.display = 'none';
    resultCard.style.display = 'block';
  }

  // もう一度別の動画を変換
  resetBtn.addEventListener('click', () => {
    resultCard.style.display = 'none';
    uploadCard.style.display = 'block';
    videoInput.value = '';
    sourceVideo.pause();
    resultVideo.pause();
    sourceVideo.onloadedmetadata = sourceVideo.onerror = null;
    sourceVideo.removeAttribute('src');
    resultVideo.removeAttribute('src');
    sourceVideo.load();
    resultVideo.load();
    originalFile = null;
    originalDuration = 0;
    downloadLink.removeAttribute('href');
    if (outputBlobUrl) URL.revokeObjectURL(outputBlobUrl);
    if (originalVideoUrl) URL.revokeObjectURL(originalVideoUrl);
    outputBlobUrl = originalVideoUrl = null;
  });

})();
