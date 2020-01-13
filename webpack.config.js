const path = require('path');

module.exports = {
    entry: './src/index.ts',
    output: {
        filename: 's3-upload-custom-resource.js',
        path: path.resolve(__dirname, 'dist'),
    },
    mode: 'production',
    target: 'node',
    externals: {
        'aws-sdk/clients/s3': 'aws-sdk/clients/s3', // Provided by the Lambda environment
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