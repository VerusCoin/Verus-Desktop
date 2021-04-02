const fs = require('fs-extra');
const _fs = require('graceful-fs');
const fsnode = require('fs');
const Promise = require('bluebird');

module.exports = (api) => {
  api.loadLocalUsers = () => {
    if (fs.existsSync(`${api.paths.agamaDir}/users.json`)) {
      let localUsersJson = fs.readFileSync(`${api.paths.agamaDir}/users.json`, 'utf8');
      let localUsers
      
      try {
        localUsers = JSON.parse(localUsersJson);
      } catch (e) {
        api.log('unable to parse local users.json', 'users');
        localUsers = {};
      }

      api.log('users set from local file', 'users');

      return localUsers
    } else {
      api.log('local users file is not found, saving empty json file.', 'users');
      api.saveLocalUsers({});

      return {};
    }
  };

  api.saveLocalUsers = (users) => {
    const usersFileName = `${api.paths.agamaDir}/users.json`;

    try {
      try {
        _fs.accessSync(api.paths.agamaDir, fs.constants.R_OK)
      } catch (e) {
        if (e.code == 'EACCES') {
          fsnode.chmodSync(usersFileName, '0666');
        } else if (e.code === 'ENOENT') {
          api.log('users directory not found', 'users');
        }
      }
     
      fs.writeFileSync(usersFileName,
                  JSON.stringify(users), 'utf8');

      
      api.log('users.json write file is done', 'users');
      api.log(`app users.json file is created successfully at: ${api.paths.agamaDir}`, 'users');
    } catch (e) {
      api.log('error writing users', 'users');
      api.log(e, 'users');
    }
  }

  api.backupLocalUsers = () => {
    const users = api.loadLocalUsers()
    const usersFileName = `${api.paths.agamaDir}/users_backup_${new Date().getTime()}.json`;

    try {
      try {
        _fs.accessSync(api.paths.agamaDir, fs.constants.R_OK)
      } catch (e) {
        if (e.code == 'EACCES') {
          fsnode.chmodSync(usersFileName, '0666');
        } else if (e.code === 'ENOENT') {
          api.log('users directory not found', 'users');
        }
      }
     
      fs.writeFileSync(usersFileName,
                  JSON.stringify(users), 'utf8');

      
      api.log(`${usersFileName} write file is done`, 'users');
      api.log(`app ${usersFileName} file is created successfully at: ${api.paths.agamaDir}`, 'users');
    } catch (e) {
      api.log('error writing users', 'users');
      api.log(e, 'users');
    }
  }

  /*
   *  type: POST
   *  params: userObj
   */
  api.setPost('/users/save', (req, res, next) => {
    if (!req.body.userObj) {
      const retObj = {
        msg: 'error',
        result: 'no userObj provided',
      };

      res.send(JSON.stringify(retObj));
    } else {
      let retObj 

      try {
        api.saveLocalUsers(req.body.userObj);

        retObj = {
          msg: 'success',
          result: 'users saved',
        };
      } catch(e) {
        retObj = {
          msg: 'error',
          result: e.message,
        };
      }

      res.send(JSON.stringify(retObj));
    }
  });

  /*
   *  type: POST
   *  params: none
   */
  api.setPost('/users/backup', (req, res, next) => {
    let retObj 

    try {
      api.backupLocalUsers();

      retObj = {
        msg: 'success',
        result: 'users saved',
      };
    } catch(e) {
      retObj = {
        msg: 'error',
        result: e.message,
      };
    }

    res.send(JSON.stringify(retObj));
  });

  /*
   *  type: POST
   *  params: none
   */
  api.setPost('/users/reset', (req, res, next) => {
    let retObj 

    try {
      api.saveLocalUsers({});

      retObj = {
        msg: 'success',
        result: 'users saved',
      };
    } catch(e) {
      retObj = {
        msg: 'error',
        result: e.message,
      };
    }

    res.send(JSON.stringify(retObj));
  });

  /*
   *  type: GET
   *
   */
  api.setGet('/users/load', (req, res, next) => {
    try {
      const obj = api.loadLocalUsers();
      res.send(JSON.stringify({
        msg: 'success',
        result: obj,
      }));
    } catch (e) {
      res.send(JSON.stringify({
        msg: 'error',
        result: e.message,
      }));
    }
  });

  /*
   *  type: POST
   *  params: none
   */
  api.setPost('/users/login', (req, res, next) => {
    const { id } = req.body
    api.currentUser = id

    res.send(JSON.stringify({
      msg: 'success',
      result: null,
    }));
  });

  /*
   *  type: POST
   *  params: none
   */
  api.setPost('/users/logout', (req, res, next) => {
    api.currentUser = null

    res.send(JSON.stringify({
      msg: 'success',
      result: null,
    }));
  });

  /*
   *  type: GET
   *  params: none
   */
  api.setGet('/users/current', (req, res, next) => {
    res.send(JSON.stringify({
      msg: 'success',
      result: api.currentUser,
    }));
  });

  return api;
};