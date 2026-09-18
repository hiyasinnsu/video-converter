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

  // --- 状態管理 ---
  let originalFile = null;
  let originalVideoUrl = null;
  let originalWidth = 0;
  let originalHeight = 0;
  let originalDuration = 0;
  let originalAspectRatio = 1;

  let isConverting = false;
  let mediaRecorder = null;
  let recordedChunks = [];
  let animFrameId = null;
  let audioContext = null;
  let audioDestination = null;
  let audioSourceNode = null;
  let outputBlobUrl = null;

  // --- ユーティリティ関数 ---
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
    originalFile = file;

    // 前回のURLがあれば解放
    if (originalVideoUrl) {
      URL.revokeObjectURL(originalVideoUrl);
    }
    originalVideoUrl = URL.createObjectURL(file);
    sourceVideo.src = originalVideoUrl;
    sourceVideo.load();

    origSizeEl.textContent = formatBytes(file.size);

    sourceVideo.onloadedmetadata = () => {
      originalWidth = sourceVideo.videoWidth;
      originalHeight = sourceVideo.videoHeight;
      originalDuration = sourceVideo.duration || 1;
      originalAspectRatio = originalWidth / originalHeight;

      origResolutionEl.textContent = `${originalWidth} × ${originalHeight}`;
      origDurationEl.textContent = formatSeconds(originalDuration);

      // 元動画の全体ビットレート（推定）
      const estimatedBps = Math.round((file.size * 8) / originalDuration);
      const estimatedKbps = Math.round(estimatedBps / 1000);
      origBitrateEl.textContent = `${estimatedKbps.toLocaleString()} kbps`;

      // 解像度の初期設定（1080p超なら720p推奨、それ以外は元サイズ）
      if (Math.min(originalWidth, originalHeight) > 720) {
        applyPreset('720');
      } else {
        targetWidthInput.value = originalWidth;
        targetHeightInput.value = originalHeight;
      }

      // ビットレートの初期設定（元動画の半分程度、または1500kbpsを上限として推奨）
      let initialBitrate = Math.min(Math.round(estimatedKbps * 0.5), 2000);
      if (initialBitrate < 400) initialBitrate = 400;
      setBitrate(initialBitrate);

      // UI切り替え
      uploadCard.style.display = 'none';
      settingsCard.style.display = 'block';
      resultCard.style.display = 'none';
      progressCard.style.display = 'none';
    };
  }

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

  // --- 変換処理（標準Web API方式） ---
  startBtn.addEventListener('click', async () => {
    if (isConverting) return;

    const targetWidth = makeEven(parseInt(targetWidthInput.value, 10) || 640);
    const targetHeight = makeEven(parseInt(targetHeightInput.value, 10) || 360);
    const targetBitrateKbps = parseInt(bitrateInput.value, 10) || 1200;
    const targetBitrateBps = targetBitrateKbps * 1000;
    const keepAudio = keepAudioCheckbox.checked;
    const playbackSpeed = parseFloat(speedSelect.value) || 1.5;

    const mimeType = getSupportedMimeType();
    if (!mimeType) {
      alert('申し訳ありません。お使いのブラウザでは動画エンコード機能（MediaRecorder）がサポートされていません。');
      return;
    }

    isConverting = true;
    recordedChunks = [];

    // UI切り替え
    settingsCard.style.display = 'none';
    progressCard.style.display = 'block';
    resultCard.style.display = 'none';
    progressBarFill.style.width = '0%';
    progressPercentage.textContent = '0%';
    progressTime.textContent = `00:00 / ${formatSeconds(originalDuration)}`;

    // Canvas準備
    renderCanvas.width = targetWidth;
    renderCanvas.height = targetHeight;
    const ctx = renderCanvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // 映像ストリーム
    const canvasStream = renderCanvas.captureStream(30);

    // 音声ストリームの取得と合成
    let combinedStream = canvasStream;
    if (keepAudio) {
      try {
        if (!audioContext) {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          audioContext = new AudioContextClass();
        }
        if (audioContext.state === 'suspended') {
          await audioContext.resume();
        }

        if (!audioSourceNode) {
          audioSourceNode = audioContext.createMediaElementSource(sourceVideo);
        }
        audioDestination = audioContext.createMediaStreamDestination();
        audioSourceNode.connect(audioDestination);
        // 音声をスピーカーに出力しないように destination のみに接続

        const audioTrack = audioDestination.stream.getAudioTracks()[0];
        if (audioTrack) {
          combinedStream = new MediaStream([
            ...canvasStream.getVideoTracks(),
            audioTrack
          ]);
        }
      } catch (err) {
        console.warn('音声トラックのキャプチャに失敗したため、映像のみでエンコードを継続します:', err);
      }
    }

    // MediaRecorder設定
    const recorderOptions = {
      mimeType: mimeType,
      videoBitsPerSecond: targetBitrateBps
    };

    try {
      mediaRecorder = new MediaRecorder(combinedStream, recorderOptions);
    } catch (e) {
      console.warn('指定コーデックオプションでの初期化失敗、デフォルトフォールバックを試みます:', e);
      mediaRecorder = new MediaRecorder(combinedStream);
    }

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      finishConversion(mimeType);
    };

    // 再生設定と描画ループ開始
    sourceVideo.currentTime = 0;
    sourceVideo.playbackRate = playbackSpeed;
    sourceVideo.muted = false; // 音声抽出のためにミュート解除（AudioContextがスピーカーには繋がっていないため無音）

    let isPlaying = false;

    function renderLoop() {
      if (!isConverting) return;

      ctx.drawImage(sourceVideo, 0, 0, targetWidth, targetHeight);

      // 進捗更新
      const current = sourceVideo.currentTime;
      const duration = originalDuration || 1;
      const pct = Math.min(99, Math.round((current / duration) * 100));

      progressBarFill.style.width = `${pct}%`;
      progressPercentage.textContent = `${pct}%`;
      progressTime.textContent = `${formatSeconds(current)} / ${formatSeconds(duration)}`;

      if (sourceVideo.ended || current >= duration - 0.05) {
        stopConversion();
        return;
      }

      if ('requestVideoFrameCallback' in sourceVideo) {
        sourceVideo.requestVideoFrameCallback(renderLoop);
      } else {
        animFrameId = requestAnimationFrame(renderLoop);
      }
    }

    sourceVideo.onplay = () => {
      isPlaying = true;
      mediaRecorder.start(500); // 500ms単位でチャンク化
      if ('requestVideoFrameCallback' in sourceVideo) {
        sourceVideo.requestVideoFrameCallback(renderLoop);
      } else {
        animFrameId = requestAnimationFrame(renderLoop);
      }
    };

    sourceVideo.onended = () => {
      stopConversion();
    };

    sourceVideo.play().catch(err => {
      console.error('動画の再生開始エラー:', err);
      alert('動画の再生処理を開始できませんでした。');
      cancelConversion();
    });
  });

  // 変換の通常停止
  function stopConversion() {
    if (!isConverting) return;
    isConverting = false;
    sourceVideo.pause();
    if (animFrameId) cancelAnimationFrame(animFrameId);
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
  }

  // キャンセル処理
  function cancelConversion() {
    isConverting = false;
    sourceVideo.pause();
    if (animFrameId) cancelAnimationFrame(animFrameId);
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    progressCard.style.display = 'none';
    settingsCard.style.display = 'block';
  }

  cancelBtn.addEventListener('click', cancelConversion);

  // 変換完了時の処理
  function finishConversion(mimeType) {
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
      savingsPercentEl.textContent = `0% (元動画より高画質設定)`;
    }

    // 結果プレビュー
    resultVideo.src = outputBlobUrl;

    // ダウンロードボタン
    const baseName = originalFile.name.replace(/\.[^/.]+$/, '');
    downloadLink.href = outputBlobUrl;
    downloadLink.download = `${baseName}_light.${extension}`;

    // 画面切り替え
    progressCard.style.display = 'none';
    resultCard.style.display = 'block';
  }

  // もう一度別の動画を変換
  resetBtn.addEventListener('click', () => {
    resultCard.style.display = 'none';
    uploadCard.style.display = 'block';
    videoInput.value = '';
    sourceVideo.src = '';
    resultVideo.src = '';
    if (outputBlobUrl) URL.revokeObjectURL(outputBlobUrl);
    if (originalVideoUrl) URL.revokeObjectURL(originalVideoUrl);
  });

})();
