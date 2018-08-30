/*
 * decaffeinate suggestions:
 * DS001: Remove Babel/TypeScript constructor workaround
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS103: Rewrite code to no longer use __guard__
 * DS104: Avoid inline assignments
 * DS204: Change includes calls to have a more natural evaluation order
 * DS206: Consider reworking classes to avoid initClass
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
// Description:
//   RSS Checker Component for Hubot RSS Reader
//
// Author:
//   @shokai

'use strict';

let RSSChecker;
const events     = require('events');
const _          = require('lodash');
const request    = require('request');
const FeedParser = require('feedparser');
const Entities   = require('html-entities').XmlEntities;
const entities   = new Entities;
const async      = require('async');
const debug      = require('debug')('hubot-rss-reader:rss-checker');
const cheerio    = require('cheerio');
const Promise    = require('bluebird');
const IrcColor   = require('irc-colors');

const charsetConvertStream = require('./charset-convert-stream');
const Entries = require('./entries');

module.exports = (RSSChecker = (function() {
    let cleanup_summary = undefined;
    RSSChecker = class RSSChecker extends events.EventEmitter {
        static initClass() {

            cleanup_summary = function(html) {
                if (html == null) { html = ''; }
                let summary = (function(html) {
                    try {
                        const $ = cheerio.load(html);
                        if (process.env.HUBOT_RSS_PRINTIMAGE === 'true') {
                            let img;
                            if (img = $('img').attr('src')) {
                                return img + '\n' + $.root().text();
                            }
                        }
                        return $.root().text();
                    } catch (error) {
                        return html;
                    }
                })(html);
                let lines = summary.split(/[\r\n]/);
                lines = lines.map(function(line) { if (/^\s+$/.test(line)) { return ''; } else { return line; } });
                summary = lines.join('\n');
                return summary.replace(/\n\n\n+/g, '\n\n');
            };
        }
        constructor(robot) {
            super();
            this.robot = robot;
            this.entries = new Entries(this.robot);
        }

        fetch(args) {
            return new Promise((resolve, reject) => {
                const default_args = {
                    url: null,
                    room: null
                };

                if (typeof args === 'string') {
                    args = {url: args};
                }
                for (let k in default_args) {
                    const v = default_args[k];
                    if (!args.hasOwnProperty(k)) {
                        args[k] = v;
                    }
                }
                debug(`fetch ${args.url}`);
                debug(args);
                const feedparser = new FeedParser;
                const req = request({
                    uri: args.url,
                    timeout: 10000,
                    encoding: null,
                    headers: {
                        'User-Agent': process.env.HUBOT_RSS_USERAGENT
                    }
                });

                req.on('error', err => reject(err));

                req.on('response', function(res) {
                    if (res.statusCode !== 200) {
                        return reject(`statusCode: ${res.statusCode}`);
                    }
                    return this
                        .pipe(charsetConvertStream())
                        .pipe(feedparser);
                });

                feedparser.on('error', err => reject(err));

                const entries = [];
                feedparser.on('data', chunk => {
                    const entry = {
                        url: chunk.link,
                        title: entities.decode(chunk.title || ''),
                        summary: cleanup_summary(entities.decode(chunk.summary || chunk.description || '')),
                        feed: {
                            url: args.url,
                            title: entities.decode(feedparser.meta.title || 'visit feed')
                        },
                        toString() {
                            let s;
                            if (process.env.HUBOT_RSS_IRCCOLORS === "true") {
                                s = `${IrcColor.pink(process.env.HUBOT_RSS_HEADER)} ${this.title} ${IrcColor.purple(`- [${this.feed.title}]`)}\n${IrcColor.lightgrey.underline(this.url)}`;
                            } else if (process.env.HUBOT_RSS_PRINTMARKDOWN === "true") {
                                s = `${process.env.HUBOT_RSS_HEADER} *${this.title} - [[${this.feed.title}](${this.url})]*`;
                            } else {
                                s = `${process.env.HUBOT_RSS_HEADER} ${this.title} - [${this.feed.title}]\n${this.url}`;
                            }

                            if ((process.env.HUBOT_RSS_PRINTSUMMARY === "true") && ((this.summary != null ? this.summary.length : undefined) > 0)) {
                                s += `\n${this.summary}`;
                            }
                            return s;
                        },
                        args
                    };

                    debug(entry);
                    entries.push(entry);
                    if (!this.entries.include(entry.url)) {
                        this.entries.add(entry.url);
                        return this.emit('new entry', entry);
                    }
                });

                return feedparser.on('end', () => resolve(entries));
            });
        }

        check(opts) {
            if (opts == null) { opts = {}; }
            return new Promise(resolve => {
                debug("start checking all feeds");
                let feeds = [];
                const object = opts.feeds || this.robot.brain.get('feeds');
                for (let room in object) {
                    const _feeds = object[room];
                    feeds = feeds.concat(_feeds);
                }
                return resolve(_.uniq(feeds));
            }).then(feeds => {
                let interval = 1;
                return Promise.each(feeds, url => {
                    return new Promise(function(resolve) {
                        setTimeout(() => {
                                return resolve(url);
                            }
                            , interval);
                        return interval = 5000;}).then(url => {
                        return (opts => {
                            opts.url = url;
                            return this.fetch(opts);
                        })(opts);
                    }).catch(err => {
                        debug(err);
                        return this.emit('error', {error: err, feed: {url}});
                    });
                });
            })
                .then(feeds =>
                    new Promise(function(resolve) {
                        debug(`check done (${(feeds != null ? feeds.length : undefined) || 0} feeds)`);
                        return resolve(feeds);
                    })
                );
        }

        getAllFeeds() {
            return this.robot.brain.get('feeds');
        }

        getFeeds(room) {
            return __guard__(this.getAllFeeds(), x => x[room]) || [];
        }

        setFeeds(room, urls) {
            if (!(urls instanceof Array)) { return; }
            const feeds = this.robot.brain.get('feeds') || {};
            feeds[room] = urls;
            return this.robot.brain.set('feeds', feeds);
        }

        addFeed(room, url) {
            return new Promise((resolve, reject) => {
                const feeds = this.getFeeds(room);
                if (_.includes(feeds, url)) {
                    return reject(`${url} is already registered`);
                }
                feeds.push(url);
                this.setFeeds(room, feeds.sort());
                return resolve(`registered ${url}`);
            });
        }

        deleteFeed(room, url) {
            return new Promise((resolve, reject) => {
                const feeds = this.getFeeds(room);
                if (_.includes(feeds, url)) {
                    feeds.splice(feeds.indexOf(url), 1);
                    this.setFeeds(room, feeds);
                    return resolve(`deleted ${url}`);
                } else if (_.includes(feeds, `${url}/`)) {
                    feeds.splice(feeds.indexOf(`${url}/`), 1);
                    this.setFeeds(room, feeds);
                    return resolve(`deleted ${url}/`);
                } else {
                    return reject(`${url} is not registered`);
                }
            });
        }

        deleteRoom(name, myname, myuser) {
            return new Promise((resolve, reject) => {
                let needle;
                if ( (name === myname) || (needle = myuser, Array.from(process.env.HUBOT_RSS_DUMP_USERS.split(",")).includes(needle)) ) {
                    const rooms = this.getAllFeeds() || {};
                    if (!rooms.hasOwnProperty(name)) {
                        return reject(`room #${name} is not exists`);
                    }
                    delete rooms[name];
                    this.robot.brain.set('feeds', rooms);
                    return resolve(`deleted room #${name}`);
                } else {
                    return reject(`not allowed to delete room #${name} from outside`);
                }
            });
        }
    };
    RSSChecker.initClass();
    return RSSChecker;
})());

function __guard__(value, transform) {
    return (typeof value !== 'undefined' && value !== null) ? transform(value) : undefined;
}
