// Get the Uploader
import Uploader from './classes/uploader.js'
import promptly from 'promptly';

const WebpackDeployer = (config = {}) => {

  let apply = (compiler) => {

    // After compiler finishes:
    compiler.plugin('after-emit', (compilation, callback) => {

      callback();

      // Instantiate the uploader
      let uploader = new Uploader();

      uploader.run(config, compiler.options);
    });
  }

  return {
    apply
  }
};

// Not ES6, but easier for require in pre ES6
module.exports = WebpackDeployer;
