const axios = require('axios');

axios.get('http://nscloud.z.cn/index.php/api/registerLocalLive', {
    params: {
        local_server: '192.168.100.115'
    }
})
    .then(function (response) {
        console.log(response);
    })
    .catch(function (error) {
        console.log(error);
    });