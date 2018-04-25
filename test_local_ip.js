'use strict';

let os = require('os');
let networkInterfaces = os.networkInterfaces();

exports.getLocalIps = function () {
    let addresses = [];

    Object.keys(networkInterfaces).forEach(function (interfaceName) {
        // var alias = 0;

        networkInterfaces[interfaceName].forEach(function (iface) {
            if ('IPv4' !== iface.family || iface.internal !== false) {
                // skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
                return;
            }
            addresses.push({name: interfaceName, address: iface.address});
        });
    });

    return addresses;
};

exports.getFirValidIp = function () {
    let addresses = this.getLocalIps();
    if (addresses === undefined || addresses.length === 0) {
        return null;
    }
    let validIp = addresses[0].address;
    addresses.forEach(function (address) {
        if (!(address.name.startsWith('lo') || address.name.startsWith('wlan'))) {
            validIp = address.address;
        }
    });

    return validIp;
};