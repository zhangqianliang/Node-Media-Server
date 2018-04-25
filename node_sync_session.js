const Logger = require('./logger');

const EventEmitter = require('events');
const {spawn} = require('child_process');

class NodeSyncSession extends EventEmitter {
    constructor(conf) {
        super();
        this.conf = conf;
    }

    run() {
        let inPath = this.conf.stream;
        let outputPath = 'rtmp://localhost:' + this.conf.port + this.conf.streamPath;
        let argv = ['-rw_timeout', '5000000', '-i', inPath, '-c', 'copy', '-f', 'flv', outputPath];
        // Logger.debug(argv.toString());
        this.ffmpeg_exec = spawn(this.conf.ffmpeg, argv);
        this.ffmpeg_exec.on('error', (e) => {
            // Logger.debug(e);
        });

        this.ffmpeg_exec.stdout.on('data', (data) => {
            // Logger.debug(`输出：${data}`);
        });

        this.ffmpeg_exec.stderr.on('data', (data) => {
            // Logger.debug(`错误：${data}`);
        });

        this.ffmpeg_exec.on('close', (code) => {
            Logger.log('[Sync stream end] ' + outputPath);
            this.emit('end');
        });
    }

    end() {
        // this.ffmpeg_exec.kill('SIGINT');
        this.ffmpeg_exec.stdin.write('q');
    }
}

module.exports = NodeSyncSession;