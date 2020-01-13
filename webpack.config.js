const path = require('path');

module.exports = {
    entry: './src/lambda-contents.ts',
    output: {
        filename: 's3-file-uploader.js',
        path: path.resolve(__dirname, 'dist'),
    },
    mode: 'production',
    target: 'node',
    externals: {
        'aws-sdk': 'aws-sdk', // Provided by the Lambda environment
        'aws-sdk/clients/s3': 'aws-sdk/clients/s3',
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            },
        ],
    },
};