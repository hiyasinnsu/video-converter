const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = __dirname;
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'converter-audit-'));
const server = http.createServer((req, res) => {
  const name = req.url === '/' ? 'index.html' : req.url.slice(1);
  if (!['index.html', 'app.js', 'style.css', 'test_sample.mp4'].includes(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', {html:'text/html',js:'text/javascript',css:'text/css',mp4:'video/mp4'}[name.split('.').pop()]);
  res.end(fs.readFileSync(path.join(root, name)));
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({channel:'chrome', headless:true});
  try {
    const page = await browser.newPage({ viewport: {width:390,height:844} });
    const errors = [], dialogs = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', async d => { dialogs.push(d.message()); await d.dismiss(); });
    const url = `http://127.0.0.1:${server.address().port}`;
    async function load(init) {
      await page.goto(url);
      if (init) await page.evaluate(init);
      await page.locator('#videoInput').setInputFiles(path.join(root,'test_sample.mp4'));
      await page.locator('#settingsCard').waitFor({state:'visible'});
      await page.locator('[data-preset="360"]').click();
    }
    async function convert(speed, audio, label) {
      await page.locator('#speedSelect').selectOption(speed);
      await page.locator('#keepAudio').setChecked(audio);
      await page.locator('#startBtn').click();
      await page.locator('#resultCard').waitFor({state:'visible',timeout:65000});
      const [download] = await Promise.all([page.waitForEvent('download'),page.locator('#downloadLink').click()]);
      const file = path.join(output, label + path.extname(download.suggestedFilename()));
      await download.saveAs(file);
      const probe = JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8'}));
      const video = probe.streams.find(s => s.codec_type === 'video');
      assert.equal(video.width,640); assert.equal(video.height,360);
      assert.equal(probe.streams.some(s => s.codec_type === 'audio'),audio && Number(speed)>=0.3);
      // WebM may omit container duration; final packet timestamp remains measurable.
      const packets = JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_packets','-show_entries','packet=pts_time','-of','json',file],{encoding:'utf8'})).packets;
      const duration = Number(packets.at(-1).pts_time);
      assert.ok(Math.abs(duration - 4/Number(speed))<0.65, `${label}: duration ${duration}`);
      assert.ok(packets.length > 10, 'video frames missing');
      if(audio && Number(speed)>=0.3) {
        const volume = spawnSync('ffmpeg',['-hide_banner','-i',file,'-af','volumedetect','-vn','-f','null','-'],{encoding:'utf8'});
        assert.equal(volume.status,0);
        assert.ok(Number(volume.stderr.match(/mean_volume: ([-\d.]+)/)?.[1]) > -60, 'audio is silent');
      }
      console.log(JSON.stringify({label,file,duration,frames:packets.length,audio:probe.streams.some(s=>s.codec_type==='audio')}));
      await page.locator('#resetBtn').click();
    }
    await load();
    // Existing preview playback and seek must not prevent recording from the beginning.
    await page.evaluate(async()=>{sourceVideo.currentTime=2; await sourceVideo.play();});
    await convert('1.0',true,'normal');
    await load(); await convert('0.25',true,'slow');
    await load(); await convert('2.0',false,'fast');
    await load(); await convert('0.75',true,'fractional');
    await load();
    await page.locator('#startBtn').click();
    await page.waitForTimeout(700);
    await page.locator('#cancelBtn').click();
    assert.equal(await page.locator('#resultCard').isVisible(), false);
    await convert('1.0',true,'retry');
    await load();
    await page.locator('#targetWidth').fill('999999');
    await page.locator('#startBtn').click();
    assert.equal(await page.locator('#progressCard').isVisible(),false);
    assert.match(dialogs.pop(),/解像度/);
    await load(()=>{ HTMLCanvasElement.prototype.captureStream=()=>{throw new Error('injected capture failure');}; });
    await page.locator('#startBtn').click();
    await page.locator('#settingsCard').waitFor({state:'visible'});
    assert.match(dialogs.pop(),/injected/);
    await load(()=>{ const Native=MediaRecorder; window.MediaRecorder=class extends Native { constructor(stream,options){if(options?.mimeType) throw Error('fallback'); super(stream,{mimeType:'video/webm'});} }; });
    await convert('2.0',false,'fallback-webm');
    await load(()=>{CanvasCaptureMediaStreamTrack.prototype.requestFrame=undefined;});
    await convert('2.0',false,'fallback-capture');
    await page.goto(url);
    await page.locator('#videoInput').setInputFiles({name:'bad.mp4',mimeType:'video/mp4',buffer:Buffer.from('bad')});
    await page.waitForFunction(()=>document.querySelector('#videoInput').value==='');
    assert.match(dialogs.pop(),/読み込めません/);
    // A delayed setup must remain cancelled even after another recording starts.
    await load(()=>{ const nativeResume=AudioContext.prototype.resume; AudioContext.prototype.resume=function(){return new Promise(resolve=>setTimeout(()=>nativeResume.call(this).then(resolve),500));}; });
    await page.locator('#startBtn').click();
    await page.locator('#cancelBtn').click();
    await convert('2.0',false,'cancel-during-setup');
    await load(()=>{ HTMLMediaElement.prototype.play=()=>Promise.reject(new Error('injected play failure')); });
    await page.locator('#startBtn').click();
    await page.locator('#settingsCard').waitFor({state:'visible'});
    assert.equal(await page.locator('#resultCard').isVisible(),false);
    assert.match(dialogs.pop(),/injected play failure/);
    await load(()=>{const Native=MediaRecorder; window.MediaRecorder=class extends Native{start(){throw Error('injected recorder failure');}};});
    await page.locator('#startBtn').click();
    await page.locator('#settingsCard').waitFor({state:'visible'});
    assert.match(dialogs.pop(),/injected recorder failure/);
    await load();
    await page.locator('#fileNameInput').fill('.mp4');
    assert.match(await page.locator('#downloadLink').getAttribute('download'),/compressed_video\.(mp4|webm)/);
    assert.deepEqual(errors,[]);
    console.log('PASS: conversions, cancellation/retry, validation, capture failure, MIME/capture fallback, invalid video');
    console.log('Artifacts: '+output);
  } finally { await browser.close(); server.close(); }
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
