//
//  Created by Mingliang Chen on 17/8/1.
//  illuspas[a]gmail.com
//  Copyright (c) 2017 Nodemedia. All rights reserved.
//
const Crypto = require('crypto');

const MESSAGE_FORMAT_0 = 0;
const MESSAGE_FORMAT_1 = 1;
const MESSAGE_FORMAT_2 = 2;

const RTMP_SIG_SIZE = 1536;
const SHA256DL = 32;
const KEY_LENGTH = 128;
const RandomCrud = new Buffer([
  0xf0, 0xee, 0xc2, 0x4a, 0x80, 0x68, 0xbe, 0xe8,
  0x2e, 0x00, 0xd0, 0xd1, 0x02, 0x9e, 0x7e, 0x57,
  0x6e, 0xec, 0x5d, 0x2d, 0x29, 0x80, 0x6f, 0xab,
  0x93, 0xb8, 0xe6, 0x36, 0xcf, 0xeb, 0x31, 0xae
])

const GenuineFMSConst = 'Genuine Adobe Flash Media Server 001';
const GenuineFMSConstCrud = Buffer.concat([new Buffer(GenuineFMSConst, 'utf8'), RandomCrud]);

const GenuineFPConst = 'Genuine Adobe Flash Player 001';
const GenuineFPConstCrud = Buffer.concat([new Buffer(GenuineFPConst, 'utf8'), RandomCrud]);

function calcHmac(data, key) {
  var hmac = Crypto.createHmac('sha256', key);
  hmac.update(data);
  return hmac.digest();
}

function cipher(key) {
  return Crypto.createCipheriv('rc4', key, '');
}

function GetClientGenuineConstDigestOffset(buf) {
  var offset = buf[0] + buf[1] + buf[2] + buf[3];
  offset = (offset % 728) + 12;
  return offset;
}

function GetServerGenuineConstDigestOffset(buf) {
  var offset = buf[0] + buf[1] + buf[2] + buf[3];
  offset = (offset % 728) + 776;
  return offset;
}

function GetClientDHOffset(buf) {
  var offset;
  offset = buf[0] + buf[1] + buf[2] + buf[3];
  offset = (offset % 632) + 772;
  return offset;
}

function GetServerDHOffset(buf) {
  var offset;
  offset = buf[0] + buf[1] + buf[2] + buf[3];
  offset = (offset % 632) + 8;
  return offset;
}

function DHKeyGenerate() {
  var dh = Crypto.getDiffieHellman('modp2');
  dh.generateKeys();
  return dh;
}

function detectClientMessageFormat(clientsig) {
  var computedSignature, msg, providedSignature, sdl;
  sdl = GetServerGenuineConstDigestOffset(clientsig.slice(772, 776));
  msg = Buffer.concat([clientsig.slice(0, sdl), clientsig.slice(sdl + SHA256DL)], 1504);
  computedSignature = calcHmac(msg, GenuineFPConst);
  providedSignature = clientsig.slice(sdl, sdl + SHA256DL);
  if (computedSignature.equals(providedSignature)) {
    return MESSAGE_FORMAT_2;
  }
  sdl = GetClientGenuineConstDigestOffset(clientsig.slice(8, 12));
  msg = Buffer.concat([clientsig.slice(0, sdl), clientsig.slice(sdl + SHA256DL)], 1504);
  computedSignature = calcHmac(msg, GenuineFPConst);
  providedSignature = clientsig.slice(sdl, sdl + SHA256DL);
  if (computedSignature.equals(providedSignature)) {
    return MESSAGE_FORMAT_1;
  }
  return MESSAGE_FORMAT_0;
}

function generateS1(messageFormat, dh) {
  var randomBytes = Crypto.randomBytes(RTMP_SIG_SIZE - 8);
  var s1Bytes = Buffer.concat([new Buffer([0, 0, 0, 0, 1, 2, 3, 4]), randomBytes], RTMP_SIG_SIZE);
  var serverDHOffset, serverDigestOffset;

  if (messageFormat === MESSAGE_FORMAT_1) {
    serverDHOffset = GetClientDHOffset(s1Bytes.slice(1532, 1536));
  } else {
    serverDHOffset = GetServerDHOffset(s1Bytes.slice(768, 772));
  }
  var serverpublicKey = dh.getPublicKey();
  serverpublicKey.copy(s1Bytes, serverDHOffset, 0, serverpublicKey.length);

  if (messageFormat === MESSAGE_FORMAT_1) {
    serverDigestOffset = GetClientGenuineConstDigestOffset(s1Bytes.slice(8, 12));
  } else {
    serverDigestOffset = GetServerGenuineConstDigestOffset(s1Bytes.slice(772, 776));
  }
  msg = Buffer.concat([s1Bytes.slice(0, serverDigestOffset), s1Bytes.slice(serverDigestOffset + SHA256DL)], RTMP_SIG_SIZE - SHA256DL);
  hash = calcHmac(msg, GenuineFMSConst);
  hash.copy(s1Bytes, serverDigestOffset, 0, 32);
  return { s1Bytes, serverpublicKey };
}

function generateS2(messageFormat, clientsig) {
  var randomBytes = Crypto.randomBytes(RTMP_SIG_SIZE - 32);
  var challengeKeyOffset, keyOffset;

  if (messageFormat === MESSAGE_FORMAT_1) {
    challengeKeyOffset = GetClientGenuineConstDigestOffset(clientsig.slice(8, 12));
  } else {
    challengeKeyOffset = GetServerGenuineConstDigestOffset(clientsig.slice(772, 776));
  }
  var challengeKey = clientsig.slice(challengeKeyOffset, challengeKeyOffset + 32);

  if (messageFormat === MESSAGE_FORMAT_1) {
    keyOffset = GetClientDHOffset(clientsig.slice(1532, 1536));
  } else {
    keyOffset = GetServerDHOffset(clientsig.slice(768, 772));
  }
  var clientPublicKey = clientsig.slice(keyOffset, keyOffset + KEY_LENGTH);
  var hash = calcHmac(challengeKey, GenuineFMSConstCrud);
  var signature = calcHmac(randomBytes, hash);
  var s2Bytes = Buffer.concat([randomBytes, signature], RTMP_SIG_SIZE);
  return { s2Bytes, clientPublicKey };
}

function generateS0S1S2(clientsig) {
  var clientType = clientsig.slice(0, 1);
  // console.log("[rtmp handshake] client type: " + clientType[0]);
  var clientsig = clientsig.slice(1);
  var dh = DHKeyGenerate(KEY_LENGTH * 8);
  var messageFormat = detectClientMessageFormat(clientsig);
  var cipherOut, cipherIn, allBytes;
  if (messageFormat === MESSAGE_FORMAT_0) {
    console.log('[rtmp handshake] using simple handshake.');
    allBytes = Buffer.concat([clientType, clientsig, clientsig]);
  } else {
    console.log('[rtmp handshake] using complex handshake. type:' + messageFormat);
    var s1 = generateS1(messageFormat, dh);
    var s2 = generateS2(messageFormat, clientsig);
    if (clientType[0] == 6) {
      var serverpublicKey = s1.serverpublicKey;
      var clientPublicKey = s2.clientPublicKey;
      var sharedSecret = dh.computeSecret(clientPublicKey);
      let keyOut = calcHmac(serverpublicKey, sharedSecret).slice(0, 16);
      let keyIn = calcHmac(clientPublicKey, sharedSecret).slice(0, 16);
      cipherOut = cipher(keyOut);
      cipherIn = cipher(keyIn);
    }
    allBytes = Buffer.concat([clientType, s1.s1Bytes, s2.s2Bytes]);
  }
  return { allBytes, cipherOut, cipherIn };
}

module.exports = { generateS0S1S2 };
