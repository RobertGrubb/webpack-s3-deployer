// Get all of the imports needed
import AWS from 'aws-sdk';
import _ from 'lodash';
import fs from 'fs';
import mime from 'mime';
import glob from 'glob';
import colors from 'colors/safe';
import promptly from 'promptly';
import Slack from 'node-slack';
import {argv} from 'yargs';
import git from 'git-rev';
import moment from 'moment';
import replace from 'replace-in-file';

/**
 * Responsible for uploading files to a specific
 * Amazon s3 Bucket.
 */
class Uploader {

  /**
   * Class Constructor
   * @param  s3 - Amazon s3 sdk
   * @param  {string} build_patch - Directory to be uploaded.
   */
  constructor() {

    // Directory to deploy
    this.buildPath = false;

    // Environment deploying to
    this.env = false;

    // S3 Variables
    this.s3 = false;
    this.s3Config = false;

    // Deployment Message
    this.deployMessage = false;

    // Configuration from webpack
    this.output = false;

    // Uploader options
    this.options = {
      pathGlob: '**/*.*',
      entryHtml: 'index.html',
      autoRun: true,
      invalidateEntry: true,
      generateDeployFile: true,
      versioning: {
        gitHash: true,
        timestamp: true,
        custom: false
      },
      robots: [
        {
          userAgent: '*',
          ignores: [ 'deploy.txt' ]
        }
      ]
    }

    // Slack defaults
    this.defaults = {
      slack: {
        username: 'Bot',
        icon_emoji: ':ghost:',
        text: 'Application deployed'
      }
    }

    // Version variables:
    this.gitHash = false;
    this.timestamp = false;
    this.version = false;
  }

  /**
   * run - Syncs options and build path, Also
   * prompts user for required info before
   * deploying.
   */
  run(config, compilerOptions) {

    let Uploader = this;

    // Set output to compiler output object.
    this.output = compilerOptions.output;

    // If options are passed, sync with class options.
    if (config.options) {
      this._syncOptions(config.options);
    }

    if (!this.options.autoRun && !argv.deploy) {
      return;
    }

    // Sync build path:
    this._syncBuildPath();

    // Display Header for Deployer
    this.log('', 'HEADER');

    // Check aws config
    this._checkEnvironmentConfig(config.environments, (error, env) => {

      if (error) {
        this.log(error, 'ERROR');
        process.exit(0);
      }

      // Display environment they are deploying to:
      this.log(`You are deploying to the ${env} environment`);

      // If deploying, prompt for a deploy message.
      promptly.prompt(
        '[Deployer]: What is this deploy about? ',
        {'default': 'No deploy message specified.'},
        (error, value) => {

          this.deployMessage = value;
          this._createDeployFile();
          this._createRobotsFile();
          this._initializeDeploy(config);
        }
      );
    });
  }

  /**
   * _initializeDeploy - This uses glob to go through the build
   * path and grab any file. (Using glob instead of
   * readdir, because readdir likes to return directories
   * as well as files, which causes problems later on).
   */
  _initializeDeploy(config) {

    // Configure and instantiate S3
    this._initializeS3(this.s3Config, (error) => {

      if (error) {
        this.log(error, 'ERROR');
        process.exit(0);
      }

      // Get last character of build path
      let lastCharOfPath = this.buildPath.slice(-1);

      /**
       * If buildpath does not have a trailing slash, add it.
       */
      if (lastCharOfPath !== '/') {
        this.buildPath += '/';
      }

      // Grab the files, then go to the _uploadFiles method
      glob(this.options.pathGlob, {cwd: this.buildPath}, (error, files) => {

        if (error) {
          this.log(error, 'ERROR');
          process.exit(0);
        }

        this.log('Deployer is now running.', 'SUCCESS');

        // Set the version variables for the files.
        this._setVersionVars((error, hash) => {

          if (error) {
            this.log(error, 'ERROR');
            process.exit(0);
          }

          this.log(`Setting deployment to version: ${this.version}`);

          // Upload files to S3
          this._uploadFiles(files, (done, fileNum) => {

            if (done) {

              // Change cloudfront root object
              this._cloudfrontInvalidateEntryHtml((error) => {

                if (error) {
                  this.log(error, 'ERROR');
                  process.exit(0);
                }

                this.log(`Deployment finished successfully. ${fileNum} files uploaded.`, 'SUCCESS');

                // Check for slack notifs:
                this._configureSlack(config.options.slack, (success) => {

                  if (success) {
                    this.log('Slack has been notified.', 'SUCCESS');
                  }
                });
              });
            }
          });
        });
      });
    });
  }

  /**
   * Validate environment configuration.
   * Check if NODE_ENV has a corresponding object in config object.
   * @param {object} config
   */
  _checkEnvironmentConfig(config, callback) {

    // If config is invalid, error out.
    if (!config) {
      this.log('Environment configuration is missing.', 'ERROR');
      process.exit(0);
    }

    let availableEnvironments = [];

    _.forEach(config, (thisEnv, index) => {
      availableEnvironments.push(index);
    });

    let stringEnvironments = availableEnvironments.join();

    promptly.choose(
      `[Deployer]: What environment are you deploying to [${stringEnvironments}]?`,
      availableEnvironments,
      (error, value) => {

        if (!config[value]) {
          this.log(`No ${value} environment configuration found.`, 'ERROR');
          process.exit(0);
        }

        // Set env:
        this.env = value;

        // Set s3Config to staging aws data.
        this.s3Config = config[value];

        // Callback with no error, and the env variable.
        callback(false, value);
      }
    );
  }

  /**
   * Set class buildPath to path specified.
   * @param {string} buildPath - With trailing slash (ex. ./dist/)
   */
  _syncBuildPath() {

    // Fall back if buildpath is not present.
    this.buildPath = this.options.buildPath ?
      this.options.buildPath :
      this.output.path;
  }

  /**
   * Merge options with existing options in class.
   * @param {object} options
   */
  _syncOptions(options) {
    Object.assign(this.options, options);
  }

  /**
   * Validate s3 configuration, and instantiate AWS.S3
   * @param {object} config - s3 configuration object
   */
  _initializeS3(config, callback) {

    if (!config) {

      // A config was not provided
      let error = 'Configuration is missing.';
      callback(error);

    } else if (!config.region || !config.params.Bucket) {

      // A config was not provided
      let error = 'Something is missing in the AWS S3 configuration.';
      callback(error);

    } else {

      if (!config.accessKeyId && !config.secretAccessKey) {
        // Get keys from the shared ini file:
        let creds = new AWS.SharedIniFileCredentials({profile: 'default'});
        AWS.config.credentials = creds;
        AWS.config.update(config);
      }

      this.s3 = new AWS.S3(config);
      callback();
    }
  }

  /**
   * _uploadFiles - Iterates through the array that is
   * passed, and uploads them to s3.
   * @param {array} files
   * TODO: Write logic that checks if file already exists
   * in bucket, and check against options if we are overwritting
   * or not.
   */
  _uploadFiles(files, callback) {
    let count = 0;
    let Uploader = this;

    // Check if there are files to upload.
    if (files.length < 1) {
      this.log('No files to upload.', 'ERROR');
      process.exit(0);
    }

    // Go through each file
    _.forEach(files, (filename) => {

      // Setup it's new path for s3
      let filePath = `${this.buildPath}/${filename}`;
      // Get the file contents.
      let fileStream = fs.createReadStream(filePath);


      // If this is not the entry html file, set version path
      if (filename.indexOf(this.options.entryHtml) === -1) {
        filename = this.options.versioning === false
          ? `${filename}`
          : `${this.version}/${filename}`;
      }

      this.log('Uploading File: ' + filename);

      // Setup a params object for the file.
      let params = {
        Key: filename,
        Body: fileStream,
        ACL: 'public-read',
        ContentType: mime.lookup(filePath)
      };

      // Upload the file to s3
      this.s3.upload(params, (error, data) => {

        if (error) {
          this.log(error, 'ERROR');
          process.exit(0);
        }

        this.log('Upload Finished: ' + filename, 'SUCCESS');

        // Increment count
        count++;

        // Check if we are at the end of the forEach.
        if (files.length === count) {
          callback(true, files.length);
        }
      });
    });
  }

  /**
   * Responsible for checking if slack will be notified
   * as well as setting up payload to be sent.
   * @param {object} Slack configuration object
   */
  _configureSlack(config, callback) {

    // Check if slack config exists.
    if (config) {

      this.log('Sending notifications to Slack.', 'SUCCESS');

      let channelList = [];
      let count = 0;

      // If no channels were specified.
      if (!config.channels) {
        this.log('Slack was unable to be notified. No channels specified.', 'ERROR');
        return;
      }

      // If no channels were specified.
      if (!config.payload) {
        this.log('Slack payload data was not found. Slack notifier is aborting.', 'ERROR');
        return;
      }

      // Check if channels value is a string, or an array. Update channel list accordingly.
      if (typeof config.channels === 'string' ||
        config.channels instanceof String) {

        channelList.push(config.cannels);
      } else {
        channelList = config.channels;
      }

      // Interate through channel list and send notification
      _.forEach(channelList, (value) => {

        let payload = config.payload;

        // If no text specified, set to default
        payload.text = payload.text ?
          payload.text :
          this.defaults.slack.text;

        // If no username specified, set to default
        payload.username = payload.username ?
          payload.username :
          this.defaults.slack.username;

        // If no icon_emoji specified, set to default
        payload.icon_emoji = payload.icon_emoji ?
          payload.icon_emoji :
          this.defaults.slack.icon_emoji;

        // Set the channel
        payload.channel = value;

        /**
         * If no attachements were set,
         * appTitle and appLink is specified
         * then add an attachment that shows the deploy message.
         */
        if (!payload.attachments && config.appTitle && config.appLink) {

          // Configure attachment:
          let payloadAttachment = [
            {
              fallback: payload.text,
              color: 'good',
              title: config.appTitle,
              title_link: config.appLink,
              text: 'Please notify the corresponding channels if you find any bugs.',
              fields: [
                {
                  title: 'Context',
                  value: this.deployMessage,
                  short: false
                }
              ]
            }
          ];

          // Set attachments to the payload.
          payload.attachments = payloadAttachment;
        }

        // Send webhook url, and payload
        this._sendSlackAlert(config.webhook, payload);

        // Increment count
        count++;

        // If count equals the channel list length, we are done here.
        if (count === channelList.length) {

          callback(true);
        }
      });
    }
  }

  /**
   * Responsible for sending payload to slack integration.
   * @param {string} webhook - Webhook URL.
   * @param {object} payload - Notification information'
   */
  _sendSlackAlert(webhook, payload) {
    let slack = new Slack(webhook);

    slack.send(payload);
  }

  /**
   * Invalidates entry html in cloudfront dist
   * @function callback()
   */
  _cloudfrontInvalidateEntryHtml(callback) {

    // Check if invalidate is enabled
    if (this.options.invalidateEntry) {

      // Check if distribution Id was provided.
      if (!this.s3Config.params.DistributionId ||
        this.s3Config.params.DistributionId === '') {

        this.log('No distribution ID provided', 'ERROR');
      }

      if (!this.s3Config.accessKeyId && !this.s3Config.secretAccessKey) {
        // Get keys from the shared ini file:
        let creds = new AWS.SharedIniFileCredentials({profile: 'default'});
        AWS.config.credentials = creds;
        AWS.config.update(this.s3Config);
      }

      // Instantiate a new instance of CloudFront sdk
      let CloudFront = new AWS.CloudFront(this.s3Config);

      // Setup config for invalidation.
      let config = {
        DistributionId: this.s3Config.DistributionId,
        InvalidationBatch: {
          CallerReference: this.timestamp.toString(),
          Paths: {
            Quantity: 1,
            Items: [ `/${this.options.entryHtml}` ]
          }
        }
      }

      // Create the invalidation for entry html
      CloudFront.createInvalidation(config, (error, data) => {

        if (error) {
          this.log(`Invalidation: ${error}`, 'ERROR');
          process.exit(0);
        } else {
          this.log(`${this.options.entryHtml} was invalidated successfully.`, 'SUCCESS');
          callback();
        }
      });
    } else {

      callback();
    }
  }

  /**
   * Sets version variables and updates entry html
   * @function callback(error, hash)
   */
  _setVersionVars(callback) {

    // Get the rev short hash
    git.short((hash) => {

      // Check if versioning is enabled.
      if (this.options.versioning != false
        && this.options.versioning != null) {

        // Set a default version
        this.version = '';

        if (this.options.versioning.custom) {
          this.version += `${this.options.versioning.custom}`;
        } else {

          // If versioning is enabled and timestamp is too, set it.
          if (this.options.versioning.timestamp === true) {
            this.timestamp = moment().unix();
            this.version += `${this.timestamp}`;
          }

          // If the gitHash is also enabled.
          if (this.options.versioning.gitHash === true) {

            // If available, set variables.
            if (hash) {
              this.gitHash = hash;

              // If both timestamp and githash is enabled, add a dash between the two.
              if (this.options.versioning.timestamp === true) {
                this.version += `-`;
              }

              // Set the version
              this.version += `${this.gitHash}`;
            } else {

              // If gitHash is enabled, but it can't be found, it makes sense to error.
              callback('Git hash was not found.', false);
            }
          }
        }

        /**
         * Added for a last resort check. If versioning is an object, but both
         * timestamp and gitHash are false, then we still do NOT want to run the search
         * and replace method, because it would screw up the paths.
         */
        if (this.options.versioning.timestamp === true
          || this.options.versioning.gitHash === true
          || this.options.versioning.custom) {
          // Search and replace entry html for version.
          this._searchAndReplaceEntry((error) => {

            if (error) {
              this.log(error, 'ERROR');
              process.exit(0);
            }

            callback(false, this.version);
          });
        } else {
          callback(true, 'Versioning is enabled, but gitHash and timestamp are false.');
        }
      } else {

        callback(false, true);
      }
    });
  }

  /**
   * Creates deploy file with deployMessage inside.
   */
  _createDeployFile() {

    if (this.options.generateDeployFile) {

      // Write the deploy message to the deploy.txt
      fs.writeFile(`${this.buildPath}/deploy.txt`, this.deployMessage, (error) => {

        if (error) {
          this.log(error, 'ERROR');
          this.log(`deploy.txt was unable to be created.`, 'ERROR');
          process.exit(0);
        }

        this.log('deploy.txt was created.');
      });
    }
  }

  /**
   * Creates robots.txt file
   */
  _createRobotsFile() {

    if (this.options.robots && this.options.robots.length >= 1) {

      // Grab options for robots
      let robotsConfig = this.options.robots;

      // Make sure the config has an object
      if (robotsConfig.length >= 1) {
        let content = '';

        // Iterate through each object
        _.forEach(robotsConfig, (robot, key) => {
          let ignoreCount = 0;

          // Set the user agent
          content += `User-agent: ${robot.userAgent}\n`;

          // Iterate through the ignored files for the agent
          _.forEach(robot.ignores, (ignore, key) => {

            // Set it
            content += `Disallow: ${ignore}\n`;

            // If this is the last ignore, add an extra new line.
            if (key === ignoreCount) {
              content += '\n';
            } else {
              ignoreCount++;
            }
          });

        });

        // Write the content to robots.txt
        fs.writeFile(`${this.buildPath}/robots.txt`, content, (error) => {

          if (error) {
            this.log(error, 'ERROR');
            this.log(`robots.txt was unable to be created.`, 'ERROR');
          }

          this.log('robots.txt was created.');
        });
      }
    }
  }

  /**
   * Search and Replace version in entry file
   */
  _searchAndReplaceEntry(callback) {

    /**
     * Checks the entry html file for relative script, or link Paths.
     * If a match is found, it will prepend the version to the beginning
     * of the path.
     */
    replace({
      files: `${this.buildPath}/${this.options.entryHtml}`,
      replace: /(src="|href=")(?!https?:\/\/)(?!\.\.\/)\.?\/?([^"]+\.(js|css))"/ig,
      with: `$1/${this.version}/$2"`
    }, (error) => {

      if (error) {
        callback(error);
      }

      callback();
    });
  }

  /**
   * Sends out a console message.
   * @param {string} string Message to be sent.
   * @param {string} type   'ERROR', 'SUCCESS'
   */
  log(string, type) {

    type = type ? type : 'DEBUG';
    string = '[Deployer]: ' + string;

    switch (type) {

      case 'SUCCESS':
        console.log(colors.green(string));
        break;

      case 'ERROR':
        console.log(colors.red(string));
        break;

      case 'HEADER':
        console.log('');
        console.log('------------------------------------');
        console.log('Webpack S3 Deployer is Initializing.');
        console.log('------------------------------------');
        console.log('');
        break;

      default:
        console.log(colors.yellow(string));
        break;
    }
  }
};

export default Uploader;
