//
//  Created by Mingliang Chen on 17/8/4.
//  illuspas[a]gmail.com
//  Copyright (c) 2017 Nodemedia. All rights reserved.
//
const EventEmitter = require('events');
const URL = require('url');

const AMF = require('./node_core_amf');
const BufferPool = require('./node_core_bufferpool');
const NodeCoreUtils = require('./node_core_utils');
const H264Header = Buffer.from([0, 0, 0, 1]);

class NodeH264Session extends EventEmitter {
  constructor(config, req, res) {
    super();
    this.config = config;
    this.req = req;
    this.res = res;
    this.bp = new BufferPool(this.handleData());
    this.bp.on('error', (e) => {

    });
    this.allow_origin = config.http.allow_origin == undefined ? '*' : config.http.allow_origin;
    this.isPublisher = false;
    this.playStreamPath = '';
    this.playArgs = null;
    this.nodeEvent = NodeCoreUtils.nodeEvent;

    this.on('connect', this.onConnect);
    this.on('play', this.onPlay);

    if (req.nmsConnectionType === 'ws') {
      this.res.on('message', this.onReqData.bind(this));
      this.res.on('close', this.onReqClose.bind(this));
      this.res.on('error', this.onReqError.bind(this));
      this.res.write = this.res.send;
      this.res.end = this.res.close;
      this.TAG = 'websocket-h264'
    } else {
      this.req.on('data', this.onReqData.bind(this));
      this.req.socket.on('close', this.onReqClose.bind(this));
      this.req.on('error', this.onReqError.bind(this));
      this.TAG = 'http-h264'
    }

  }

  run() {
    let method = this.req.method;
    let urlInfo = URL.parse(this.req.url, true);
    let streamPath = urlInfo.pathname.split('.')[0];
    let format = urlInfo.pathname.split('.')[1];
    this.connectCmdObj = { method, streamPath, query: urlInfo.query };
    this.nodeEvent.emit('preConnect', this.id, this.connectCmdObj);

    this.isStarting = true;
    this.bp.init();

    this.connectTime = new Date();

    if (format != 'h264') {
      console.log(`[${this.TAG}] Unsupported format=${format}`);
      this.res.statusCode = 403;
      this.res.end();
      return;
    }
    this.nodeEvent.emit('postConnect', this.id, this.connectCmdObj);
    if (method == 'GET') {
      //Play 
      this.playStreamPath = streamPath;
      this.playArgs = urlInfo.query;
      console.log(`[${this.TAG} play] play stream ` + this.playStreamPath);
      this.emit('play');

    } else {
      console.log(`[${this.TAG}] Unsupported method=` + method);
      this.res.statusCode = 405;
      this.res.end();
      return;
    }
  }

  onReqData(data) {
    this.bp.push(data);
  }

  onReqClose() {
    this.stop();
  }

  onReqError(e) {
    this.stop();
  }

  stop() {
    if (this.isStarting) {
      this.isStarting = false;
      this.bp.stop();
    }
  }

  reject() {
    this.stop();
  }

  * handleData() {

    console.log(`[${this.TAG} message parser] start`);
    while (this.isStarting) {
      if (this.bp.need(9)) {
        if (yield) break;
      }
    }

    console.log(`[${this.TAG} message parser] done`);
    if (this.isPublisher) {

    } else {
      let publisherId = this.publishers.get(this.playStreamPath);
      if (publisherId != null) {
        this.sessions.get(publisherId).players.delete(this.id);
        this.nodeEvent.emit('donePlay', this.id, this.playStreamPath, this.playArgs);
      }
    }
    this.nodeEvent.emit('doneConnect', this.id, this.connectCmdObj);
    this.res.end();
    this.idlePlayers.delete(this.id);
    this.sessions.delete(this.id);
    this.idlePlayers = null;
    this.publishers = null;
    this.sessions = null;
  }

  respondUnpublish() {
    this.res.end();
  }

  onConnect() {

  }

  onPlay() {

    this.nodeEvent.emit('prePlay', this.id, this.playStreamPath, this.playArgs);
    if (!this.isStarting) {
      return;
    }
    if (this.config.auth !== undefined && this.config.auth.play) {
      let results = NodeCoreUtils.verifyAuth(this.playArgs.sign, this.playStreamPath, this.config.auth.secret);
      if (!results) {
        console.log(`[${this.TAG}] Unauthorized. ID=${this.id} streamPath=${this.playStreamPath} sign=${this.playArgs.sign}`);
        this.res.statusCode = 401;
        this.res.end();
        return;
      }
    }

    if (!this.publishers.has(this.playStreamPath)) {
      console.log(`[${this.TAG} play] stream not found ` + this.playStreamPath);
      this.idlePlayers.add(this.id);
      return;
    }

    let publisherId = this.publishers.get(this.playStreamPath);
    let publisher = this.sessions.get(publisherId);
    let players = publisher.players;
    players.add(this.id);

    if (this.res.setHeader !== undefined) {
      this.res.setHeader('Content-Type', 'video/h264');
      this.res.setHeader('Access-Control-Allow-Origin', this.allow_origin);
    }

    if (publisher.videoCodec == 7) {
      let spspps = NodeH264Session.createH264Message(null, publisher.avcSequenceHeader);
      this.res.write(spspps);
    }

    //send gop cache
    if (publisher.h264GopCacheQueue != null) {
      for (let h264Message of publisher.h264GopCacheQueue) {
        this.res.write(h264Message);
      }
    }
    console.log(`[${this.TAG} play] join stream ` + this.playStreamPath);
    this.nodeEvent.emit('postPlay', this.id, this.playStreamPath, this.playArgs);
  }


  static createH264Message(rtmpHeader, rtmpBody) {
    let frame_type = rtmpBody[0];
    let codec_id = frame_type & 0x0f;
    frame_type = (frame_type >> 4) & 0x0f;
    let sps, pps;
    let ret = null
    if (codec_id == 7) {
      if (frame_type == 1 && rtmpBody[1] == 0) {
        let spsNum = rtmpBody[10] & 0x1f;
        if (spsNum == 1) {
          let spsLen = rtmpBody.readUInt16BE(11);
          sps = rtmpBody.slice(13, 13 + spsLen);
          let ppsNum = rtmpBody[13 + spsLen] & 0x1f;
          if (ppsNum == 1) {
            let ppsLen = rtmpBody.readUInt16BE(14 + spsLen);
            pps = rtmpBody.slice(16 + spsLen, 16 + spsLen + ppsLen);
            ret = Buffer.concat([H264Header, sps, H264Header, pps]);
          }
        }
      } else {
        let body = rtmpBody.slice(5);
        let nalArray = [];
        while (body.length > 4) {
          let len = body.readUInt32BE();
          let nal = body.slice(4, 4 + len);
          body = body.slice(4 + len);
          nalArray.push(H264Header);
          nalArray.push(nal);
        }
        ret = Buffer.concat(nalArray);
      }
    }
    return ret;
  }

}

module.exports = NodeH264Session;
