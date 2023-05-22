# S3 Upload Custom Resource Lambda Layer [![Build Status](https://github.com/quittle/s3-upload-custom-resource-lambda-layer/actions/workflows/npm.yml/badge.svg)](https://github.com/quittle/s3-upload-custom-resource-lambda-layer/actions/workflows/npm.yml)

This project builds an [AWS Lambda Layer](https://docs.aws.amazon.com/lambda/latest/dg/configuration-layers.html) to deploy files to S3 buckets as part of a CloudFormation deployment. Using [AWS SAM](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/what-is-sam.html), you can use a Lambda function and a [CloudFormation Custom Resource](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/template-custom-resources.html) to upload files to your S3 bucket. All the deployment logic is baked into the layer provided by this project so the only things needed from the consumer is the files, the generated Lambda function, and the permissions to deploy to the bucket. Here is a minimal example of how to use it.

This project used to recommend taking a dependency on a layer exposed by this project's AWS account. This has numerous issues including security concerns from consumers and difficulty exposing the latest version of the layer. Going forward, this project will release the layer as a zip file available in each release of the project.

## Example CloudFormation Template

**Preferred method of consumption**

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Transform: AWS::Serverless-2016-10-31
Parameters:
    DeploymentContentVersion:
        Type: String
        Description: This can be any unique string that identifies the current set of files you are deploying.
Resources:
    WebsiteBucket:
        Type: AWS::S3::Bucket
    S3UploadLambdaLayer:
        Type: AWS::Serverless::LayerVersion
        Properties:
            # This can be npm installed or downloaded as a GitHub release artifact
            ContentUri: node_modules/s3-upload-custom-resource-lambda-layer/dist/layer.zip
    S3UploadLambda:
        Type: AWS::Serverless::Function
        Properties:
            Layers: [!Ref S3UploadLambdaLayer]
            CodeUri:
                local/path/to/assets # This is a local path to a folder of files you want to deploy,
                # either your build or source directory, depending on how your
                # site is configured.
            Handler:
                s3-upload-custom-resource.handler # This is fixed and references a file provided by
                # this project and available in the Lambda layer.
            Runtime: nodejs18.x
            Policies:
                - S3CrudPolicy:
                      BucketName: !Ref WebsiteBucket
    DeployWebsite:
        Type: Custom::UploadFilesToS3
        Properties:
            ServiceToken: !GetAtt S3UploadLambda.Arn
            BucketName: !Ref WebsiteBucket
            ContentVersion: !Ref DeploymentContentVersion
```

**Legacy method of consumption**

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Transform: AWS::Serverless-2016-10-31
Parameters:
    DeploymentContentVersion:
        Type: String
        Description: This can be any unique string that identifies the files you are deploying.
Resources:
    WebsiteBucket:
        Type: AWS::S3::Bucket
    S3UploadLambda:
        Type: AWS::Serverless::Function
        Properties:
            Layers: [arn:aws:lambda:us-east-1:915290536872:layer:S3UploadCustomResource:5]
            CodeUri:
                local/path/to/assets # This is a local path to a folder of files you want to deploy,
                # either your build or source directory, depending on how your
                # site is configured.
            Handler:
                s3-upload-custom-resource.handler # This is fixed and references a file provided by
                # this project and available in the Lambda layer.
            Runtime: nodejs18.x
            Policies:
                - S3CrudPolicy:
                      BucketName: !Ref WebsiteBucket
    DeployWebsite:
        Type: Custom::UploadFilesToS3
        Properties:
            ServiceToken: !GetAtt S3UploadLambda.Arn
            BucketName: !Ref WebsiteBucket
            ContentVersion: !Ref DeploymentContentVersion
```

## Sample Deployment Command

If you make sure to generate a JSON template, you can use [`jq` (Link)](https://stedolan.github.io/jq/) to determine a unique identifier for your content without additional work.

```bash
aws cloudformation package \
            --template-file template.yml \
            --s3-bucket "${YOUR_SAM_BUCKET_NAME}" \
            --output-template-file build/template.json \
            --use-json

code_uri="$(jq '.Resources.S3UploadLambda.Properties.CodeUri' build/template.json --raw-output)"

aws cloudformation deploy \
        --template-file build/template.json \
        --stack-name "${YOUR_STACK_NAME}" \
        --capabilities CAPABILITY_IAM \
        --parameter-overrides "DeploymentContentVersion=${code_uri}" \
        --no-fail-on-empty-changeset
```

## CloudFormation Parameters

### ServiceToken `String`

The ARN of the function used to deploy the resources.

This is not a parameter defined by this project, but comes from [CloudFormation's Custom Resource documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-cfn-customresource.html).

### BucketName `String`

The name of the S3 bucket to deploy to. Without an `ObjectPrefix`, it must be empty before it can be attached to an uploader resource and will fill to create if not.

### ObjectPrefix `String` - _Optional_

Optional prefix to prepend to all objects uploaded. If provided, multiple upload resources can use the same bucket so long as the prefixes are unique and no objects already exist in the bucket with those prefixes.

### ContentVersion `String` - _Optional_

`ContentVersion` is not strictly required today, but may be in a future version of the layer. It is used to identify the version of the content with the only requirement being that a different version is chosen every time the content changes.

This may be a Git commit or the hash of the content being deployed. One of the simplest ways is to re-use the S3 URI generated by `aws cloudformation package` and injected into the generated CloudFormation template for the Lambda resource under the `CodeUri` property. This URI is based on the hash of the content to be uploaded and is guaranteed to change when your content changes and can prevent unnecessary re-deployments.

## S3 Object Configuration

You can additionally configure the S3 objects you upload by providing a file with the name `.s3uploadconfig.json` in the root directory of the files you are uploading. This is a JSON file that maps glob-based patterns to configuration to set on the S3 objects. If multiple globs are matched for a given key, they are merged in a non-deterministic order so be careful trying to override values. Currently the only two fields supported are `metadata` and `contentType`. If unspecified, the default `contentType` is defaulted by S3 to `application/octet-stream`.

Here is an example `.s3uploadconfig.json` that will make all HTML files vended by S3 pass `text/html` as their `Content-Type` HTTP header if retrieved via CloudFront or S3 static website hosting. It also marks all Unix-style hidden files as hidden in their metadata.

```json
{
    "**/*.html": {
        "contentType": "text/html"
    },
    ".*": {
        "metadata": {
            "hiddenFile": "true"
        },
        "cacheControl": "max-age=600"
    }
}
```

## Warnings

1. Any contents under the object prefix (or in the bucket if `ObjectPrefix` is not specified) will be deleted when the custom resource managing it is updated or deleted, regardless of whether the resources were managed by the upload resource.

2. CloudFormation changes that switch the bucket being deployed to may fail if the Lambda function backing it does not have permission to deploy to delete objects in the original bucket. You will have to create a new custom resource, with a different name and different backing Lambda.

# Development

To validate locally before pushing, run `AWS_REGION=us-east-1 npm run build-and-test`.

Other targets of interest

-   `build` - Runs the build and generates the lambda layer contents
-   `unit-test` - Runs the unit test suite
-   `integration-test` - Runs the integration test suite (requires AWS credentials)
-   `test` - Runs all tests
-   `release` - This deploys to the production stack. **Do not run manually.**
-   `check` - Runs static analysis and tests
-   `prettier-fix` - Automatically fixes Prettier issues
-   `lint-fix` - Automatically fixes ESLint issues

## Releases

1. Push the latest change and wait for the build to pass
1. Tag the latest commit with the version like so `git tag -a vX.Y.Z -m X.Y.Z` and push the tag
1. The GitHub release should be created automatically as well as updating the NPM package.

## Debugging

If you see `ConfigError: Missing region in config` when running the integration test suite. You need to set the AWS region you are testing against in your environment variables. Running `AWS_REGION=us-east-1 npm run integration-test` should solve the problem.
