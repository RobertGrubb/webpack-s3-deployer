// Get the Uploader
import Uploader from './classes/uploader.js'
import promptly from 'promptly';

const WebpackDeployer = (config = {}) => {

  let apply = (compiler) => {

    let deploying = false;

    /**
     * When the webpack compiler starts running,
     * we want to prompt them on whether they want to
     * deploy or not, rather than waiting until after the
     * build. This way they dont have to wait around until after
     * the compiler runs to answer this question, and allows them
     * to not have to stay at the computer.
     */
    compiler.plugin('compilation', (compilation) => {

      promptly.choose(
        '[Webpack Deployer]: Will you be deploying to AWS [Y/n]? ',
        ['y', 'Y', 'n', 'N'],
        (error, value) => {
          if (value === 'y' || value === 'Y') {
            deploying = true;
          } else {
            console.log('You have chosen not to deploy... Continuing with webpack build.');
          }
        }
      );
    });

    // After compiler finishes:
    compiler.plugin('after-emit', (compilation, callback) => {

      callback();

      if (deploying === true) {

        // Instantiate the uploader
        let uploader = new Uploader();

        uploader.run(config, compiler.options);
      }
    });
  }

  return {
    apply
  }
};

// Not ES6, but easier for require in pre ES6
module.exports = WebpackDeployer;
