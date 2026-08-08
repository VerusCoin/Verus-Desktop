const fs = require('fs-extra');
const { atomicWriteFileSync } = require("./utils/atomicFile");

const validateUsers = (users) => {
  if (!users || typeof users !== "object" || Array.isArray(users)) {
    throw new Error("Users data must be an object");
  }
  return users;
};
const validateUsersBuffer = (buffer) => validateUsers(JSON.parse(buffer.toString("utf8")));

module.exports = (api) => {
  api.loadLocalUsers = () => {
    if (fs.existsSync(`${api.paths.agamaDir}/users.json`)) {
      const usersFile = `${api.paths.agamaDir}/users.json`;
      fs.chmodSync(usersFile, 0o600);
      let localUsersJson = fs.readFileSync(usersFile, 'utf8');
      let localUsers
      
      try {
        localUsers = validateUsers(JSON.parse(localUsersJson));
      } catch (e) {
        api.log('unable to parse local users.json', 'users');
        const backupFile = `${usersFile}.bak`;
        if (fs.existsSync(backupFile)) {
          try {
            localUsers = validateUsers(JSON.parse(fs.readFileSync(backupFile, 'utf8')));
            api.log('Using validated users.json.bak without modifying either file.', 'users');
            return localUsers;
          } catch (backupError) {
            api.log(`unable to parse users.json.bak: ${backupError.message}`, 'users');
          }
        }
        throw new Error(`Existing users.json is invalid and was left unchanged: ${e.message}`);
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
      validateUsers(users);
      atomicWriteFileSync(usersFileName, JSON.stringify(users), {
        backup: true,
        mode: 0o600,
        validate: validateUsersBuffer,
      });

      api.log('users.json write file is done', 'users');
      api.log(`app users.json file is created successfully at: ${api.paths.agamaDir}`, 'users');
    } catch (e) {
      api.log('error writing users', 'users');
      api.log(e, 'users');
      throw e;
    }
  }

  api.backupLocalUsers = () => {
    const users = api.loadLocalUsers()
    const usersFileName = `${api.paths.agamaDir}/users_backup_${new Date().getTime()}.json`;

    try {
      atomicWriteFileSync(usersFileName, JSON.stringify(users), {
        backup: false,
        mode: 0o600,
        validate: validateUsersBuffer,
      });
      api.log(`${usersFileName} write file is done`, 'users');
      api.log(`app ${usersFileName} file is created successfully at: ${api.paths.agamaDir}`, 'users');
    } catch (e) {
      api.log('error writing users', 'users');
      api.log(e, 'users');
      throw e;
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
