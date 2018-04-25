const Logger = require('./logger');
const axios = require('axios');
const NodeSyncSession = require('./node_sync_session');

class NodeSyncServer {
    constructor(config) {
        this.config = config;
        this.pullSessions = new Map();
        this.pullIntervalEvent = null;
    }

    run() {
        this.pullIntervalEvent = setInterval(function (func, that) {
            func(that);
        }, 10000, NodeSyncServer.fetchLiveStreams, this);
        Logger.log(`Node Media Sync Server started`);
    }

    stop() {
        clearInterval(this.pullIntervalEvent);

        const streamIds = this.pullSessions.keys();
        streamIds.forEach(function (streamId) {
            this.pullSessions.get(streamId).end();
            this.pullSessions.delete(streamId);
        })
    }

    static async fetchLiveStreams(that) {
        // 10s request center server
        const url = that.config.server.center_url + 'index.php/api/registerLocalLive';
        const localServer = that.config.server.local_url;
        try {
            const response = await axios.get(url, {
                params: {
                    local_server: localServer,
                    local_rtmp_port: that.config.rtmp.port,
                    local_http_port: that.config.http.port
                }
            });
            if (response.status >= 200 && response.status < 300) {
                Logger.debug(`Node Sync Server sync center server data: ${JSON.stringify(response.data)}`);
                const liveStreams = response.data.data.live_streams;
                if (liveStreams !== undefined && liveStreams.length > 0) {
                    // setup pull streams
                    that.setupLiveStreams(liveStreams);
                }
            } else {
                Logger.log(`Node Sync Server sync center server fail: ${response.data}`);
            }
        } catch (error) {
            Logger.log(`Node Sync Server sync center server error: ${error}`);
        }
    }

    setupLiveStreams(streams) {
        for (let i = 0, len = streams.length; i < len; i++) {
            const stream = streams[i];
            const streamId = NodeSyncServer.getStreamId(stream);
            if (!this.pullSessions.has(streamId)) {
                this.initSyncSession(stream, streamId);
            }
        }

        // no need to end stream not online, session auto end when complete.
    }

    static getStreamId(stream) {
        // rtmp
        if (stream.startsWith('rtmp://')) {
            const streamArgs = stream.split('/');
            return streamArgs[streamArgs.length - 1];
        } else if (stream.startsWith('http://')) { //m3u8
            const streamArgs = stream.split('/');
            return streamArgs[streamArgs.length - 2];
        }
        return null;
    }

    initSyncSession(stream, streamId) {
        let conf = {};
        conf.port = this.config.rtmp.port;
        conf.ffmpeg = this.config.trans.ffmpeg;
        conf.streamPath = '/live/' + streamId;
        conf.stream = stream;
        let session = new NodeSyncSession(conf);
        this.pullSessions.set(streamId, session);
        session.on('end', () => {
            this.pullSessions.delete(streamId);
        });
        session.run();
    }
}

module.exports = NodeSyncServer;