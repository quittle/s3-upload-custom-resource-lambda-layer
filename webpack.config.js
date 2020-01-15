const path = require('path');

module.exports = {
    entry: './src/index.ts',
    output: {
        filename: 's3-upload-custom-resource.js',
        path: path.resolve(__dirname, 'dist'),
    },
    mode: 'development',
    target: 'node',
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