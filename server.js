const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeStatic = require('ffprobe-static');
const ffmpeg = require('fluent-ffmpeg');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeStatic.path);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let clipsDir = '';

// Set clips directory
app.post('/api/set-dir', (req, res) => {
  const { dir } = req.body;
  if (!fs.existsSync(dir)) return res.status(400).json({ error: 'Directory not found' });
  clipsDir = dir.replace(/[/\\]+$/, '');
  res.json({ ok: true });
});

// List video files
app.get('/api/clips', (req, res) => {
  if (!clipsDir) return res.status(400).json({ error: 'No directory set' });
  try {
    const files = fs.readdirSync(clipsDir)
      .filter(f => /\.(mp4|mov|avi|mkv|ts)$/i.test(f))
      .sort();
    res.json(files);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Stream a video file with range support
app.get('/api/video/:filename', (req, res) => {
  const filePath = path.join(clipsDir, req.params.filename);
  if (!filePath.startsWith(clipsDir + path.sep)) return res.status(403).end();
  if (!fs.existsSync(filePath)) return res.status(404).end();

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;
    const file = fs.createReadStream(filePath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/mp4',
    });
    file.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// Get metadata for a file
app.get('/api/metadata/:filename', (req, res) => {
  const filePath = path.join(clipsDir, req.params.filename);
  if (!filePath.startsWith(clipsDir + path.sep)) return res.status(403).end();
  ffmpeg.ffprobe(filePath, (err, metadata) => {
    if (err) return res.status(500).json({ error: err.message });
    const vs = metadata.streams.find(s => s.codec_type === 'video') || {};
    const fmt = metadata.format || {};
    res.json({
      duration: fmt.duration,
      size: fmt.size,
      bitrate: fmt.bit_rate,
      width: vs.width,
      height: vs.height,
      codec: vs.codec_name,
      fps: vs.r_frame_rate,
      created: fmt.tags && (fmt.tags.creation_time || fmt.tags.date),
      gps: fmt.tags && fmt.tags.location,
    });
  });
});

// Export a single group (array of segments) to one output file
function exportGroup(segments, outFile, done) {
  if (segments.length === 1) {
    const { file, inPoint, outPoint } = segments[0];
    const src = path.join(clipsDir, file);
    const cmd = ffmpeg(src);
    if (inPoint > 0) cmd.setStartTime(inPoint);
    cmd.setDuration(outPoint - inPoint)
      .outputOptions(['-c:v copy', '-c:a copy'])
      .output(outFile)
      .on('end', () => done(null, outFile))
      .on('error', err => done(err))
      .run();
  } else {
    const tmpFiles = [];
    const tmpList = path.join(os.tmpdir(), `dashcam_concat_${Date.now()}.txt`);

    const trimNext = (idx) => {
      if (idx >= segments.length) {
        const listContent = tmpFiles.map(f => `file '${f}'`).join('\n');
        fs.writeFileSync(tmpList, listContent);
        ffmpeg()
          .input(tmpList)
          .inputOptions(['-f concat', '-safe 0'])
          .outputOptions(['-c copy'])
          .output(outFile)
          .on('end', () => {
            tmpFiles.forEach(f => { try { fs.unlinkSync(f); } catch (_) {} });
            fs.unlinkSync(tmpList);
            done(null, outFile);
          })
          .on('error', err => done(err))
          .run();
        return;
      }
      const { file, inPoint, outPoint } = segments[idx];
      const src = path.join(clipsDir, file);
      const tmpOut = path.join(os.tmpdir(), `dashcam_seg_${Date.now()}_${idx}.mp4`);
      tmpFiles.push(tmpOut);
      const cmd = ffmpeg(src);
      if (inPoint > 0) cmd.setStartTime(inPoint);
      cmd.setDuration(outPoint - inPoint)
        .outputOptions(['-c:v copy', '-c:a copy'])
        .output(tmpOut)
        .on('end', () => trimNext(idx + 1))
        .on('error', err => done(err))
        .run();
    };
    trimNext(0);
  }
}

// Export groups — each group becomes one output file
app.post('/api/export', (req, res) => {
  const { groups, outputDir } = req.body;
  // groups: [{segments: [{file, inPoint, outPoint}], outputName}]

  const outDir = outputDir || os.homedir() + '/Desktop';
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const results = [];

  const processNext = (idx) => {
    if (idx >= groups.length) return res.json({ results });
    const { segments, outputName } = groups[idx];
    const outFile = path.join(outDir, outputName || `export_${Date.now()}_${idx + 1}.mp4`);
    exportGroup(segments, outFile, (err, file) => {
      if (err) {
        results.push({ ok: false, error: err.message, outputName });
      } else {
        results.push({ ok: true, outFile: file, outputName });
      }
      processNext(idx + 1);
    });
  };

  processNext(0);
});

const PORT = 3847;
app.listen(PORT, () => {
  console.log(`Dashcam Editor running at http://localhost:${PORT}`);
});
