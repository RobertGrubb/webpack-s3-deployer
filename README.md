# Webpack S3 Deployer
----------

**What is Webpack Deployer?**

Webpack Deployer is a plugin for webpack that allows you to deploy your application to AWS S3 Buckets by adding a simple configuration to your webpack config file.

**How to import Webpack Deployer (pre es6)**

    var WebpackDeployer = require('webpack-s3-deployer');

**How to import Webpack Deployer (es6 +)**

    import WebpackDeployer from 'webpack-s3-deployer'

**Example deploy script if autoRun is set to false**

    "deploy": "npm run build -- --deploy"

**How to configure Webpack Deployer in webpack configuration**

    new WebpackDeployer({
      environments: {
        staging: {
          region: 'us-west-2',
          params: {
            Bucket: 'staging.somebucket.com',
            DistributionId: 'BUCKETIDHERE'
          }
        },
        production: {
          region: 'us-west-2',
          params: {
            Bucket: 'somebucket.com',
            DistributionId: 'BUCKETIDHERE'
          }
        }
      }
      options: {
        autoRun: true,
        entryHtml: 'index.html',
        invalidateEntry: true,
        generateDeployFile: true,
        versioning: {
          timestamp: true,
          gitHash: true,
          custom: false
        },
        robots: {
          generate: true,
          items: [
            {
              userAgent: '<UserAgentHere>',
              ignores: [ '<FileName or Directory Here>' ]
            }
          ]
        },
        slack: {
          channels: ['#channel1', '#channel2'],
          webhook: '<Webhook URL>',
          appTitle: '<Application Title>',
          appLink: '<Application URL>',
          payload: {
            username: '<BotName>',
            icon_emoji: ':ghost:',
            text: '<Slack Notification Text>'
          }
        }
      }
    })

**How many environments can I have?**

As many as you want.

**Do I have to use versioning?**

No, see options below for how to disable.

**Does it support slack notifications?**

Yes, but you will have to setup a webhook from your slack settings before you can use it. Once you have set it up, look below for more information.

**Does webpack deployer support FTP?**

At this time, FTP support is not included, however we are looking into doing so in the future, however, a timeline is not available on that.

## Configuration Details

> **environments** [required | object] - Objects for environments that contain AWS config.


> **options** [optional | object] - Options for deployer. See below for more information.

## Options

> **autoRun** [optional | boolean] - Sets whether the deployer autoRuns or not. If it is set to false, a `--deploy`
flag must be passed in order to start the deployer.

> **entryHtml** [optional | string] - Sets the entry html file for the application. [Defaults to index.html]

> **invalidateEntry** [optional | boolean] - Whether or not the deployer will invalidate the entry html file in cloudfront.

> **robots** [optional | array] - Sets configuration for robots.txt that will be generated on deploy. See example configuration above for an idea how how to set it. Multiple user agents are supported, simply add another object inside of the array.

**Versioning [Optional | See example above for default setting | Set versioning: false to disable]**

> **timestamp** [optional | boolean] - Default: true - By default, versioning is set as an object,
and inside this object timestamp is set to true. This will use timestamp in the version that the
deployer will use to set the path that your files will be uploaded to. (Ex. 12412516/your_files_here)

> **gitHash** [optional | boolean] - Default: true - By default, versioning is set as an object,
and inside this object gitHash is set to true. This will use git rev hash in the version that the
deployer will use to set the path that your files will be uploaded to. (Ex. aa23redg/your_files_here)

> **custom** [optional | false or string] - Default: false - Custom is a string that can be passed
to the deployer to set a custom path that the deployer will upload your files to (Ex. custom_path/your_files_here)

**Slack [Optional]**

> **channels** [required | array, string] - Accepts both a string, or an array. (Include # in front of channel name.)

> **webhook** [required | string] - Webhook URL for Slack.

> **appTitle** [optional | string] - App Name. (Optional, but required for showing of deploy message.)

> **appLink** [optional | string] - App URL. (Optional, but required for showing of deploy message.)

> **payload** [required | object] - Payload object for slack. (text, username, icon)


**Path Related Options [Optional]**

> **pathGlob** [optional | string] - Handles what files are uploaded.

> **buildPath** [optional | string] - Path webpack builds files to. (ex. ./dist/, ./build/) If not specified, it defaults to webpack's output.path
