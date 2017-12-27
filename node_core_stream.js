//
//  Created by Mingliang Chen on 17/12/27.
//  illuspas[a]gmail.com
//  Copyright (c) 2017 Nodemedia. All rights reserved.
//

class NodeCoreStream {
  constructor(stream) {
    this.stream = stream;
    this.streamInterrupter;
    this.readBytes = 0;
  }

  //sync read
  read(size) {
    return new Promise((resolve, reject) => {
      this.streamInterrupter = reject;
      const onReadable = () => {
        let chunk = this.stream.read(size);
        if (chunk != null) {
          this.readBytes += size;
          this.stream.removeListener('readable', onReadable);
          resolve(chunk);
        }
      }
      this.stream.on('readable', onReadable)
      onReadable()
    });
  }

  //async write
  write(chunk) {
    this.stream.write(chunk);
  }

  stop() {
    this.streamInterrupter('stop');
  }
}

module.exports = NodeCoreStream;