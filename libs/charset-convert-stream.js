/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
// detect charset from "encoding" attribute of XML
// convert using iconv

'use strict';

const stream = require('stream');
const { Iconv }  = require('iconv');
const debug  = require('debug')('hubot-rss-reader:charset-convert-stream');

module.exports = function() {

    let iconv = null;
    let charset = null;

    const charsetConvertStream = stream.Transform();

    charsetConvertStream._transform = function(chunk, enc, next) {
        let m;
        if ((charset === null) &&
            (m = chunk.toString().match(/<\?xml[^>]* encoding=['"]([^'"]+)['"]/))) {
            charset = m[1];
            debug(`charset: ${charset}`);
            if (charset.toUpperCase() !== 'UTF-8') {
                iconv = new Iconv(charset, 'UTF-8//TRANSLIT//IGNORE');
            }
        }
        if (iconv != null) {
            this.push(iconv.convert(chunk));
        } else {
            this.push(chunk);
        }
        return next();
    };

    return charsetConvertStream;
};
