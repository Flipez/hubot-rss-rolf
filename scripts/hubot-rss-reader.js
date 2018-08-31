/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS104: Avoid inline assignments
 * DS204: Change includes calls to have a more natural evaluation order
 * DS205: Consider reworking code to avoid use of IIFEs
 * DS207: Consider shorter variations of null checks
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
// Description:
//   Hubot RSS Reader
//
// Commands:
//   hubot rss add https://github.com/Flipez.atom
//   hubot rss delete https://brauser.io/index.xml
//   hubot rss delete #room_name
//   hubot rss list
//
// Author:
//   @Flipez

'use strict';

const path       = require('path');
const _          = require('lodash');
const debug      = require('debug')('hubot-rss-reader');
const Promise    = require('bluebird');
const RSSChecker = require(path.join(__dirname, '../libs/rss-checker'));
const FindRSS    = Promise.promisify(require('find-rss'));

//# config
const package_json = require(path.join(__dirname, '../package.json'));
if (!process.env.HUBOT_RSS_INTERVAL) { process.env.HUBOT_RSS_INTERVAL = 60*10; }  // 10 minutes
if (!process.env.HUBOT_RSS_HEADER) { process.env.HUBOT_RSS_HEADER = ':sushi:'; }
if (!process.env.HUBOT_RSS_USERAGENT) { process.env.HUBOT_RSS_USERAGENT = `hubot-rss-rolf/${package_json.version}`; }
if (!process.env.HUBOT_RSS_PRINTSUMMARY) { process.env.HUBOT_RSS_PRINTSUMMARY = "true"; }
if (!process.env.HUBOT_RSS_PRINTIMAGE) { process.env.HUBOT_RSS_PRINTIMAGE = "true"; }
if (!process.env.HUBOT_RSS_PRINTMARKDOWN) { process.env.HUBOT_RSS_PRINTMARKDOWN = "false"; }
if (!process.env.HUBOT_RSS_PRINTERROR) { process.env.HUBOT_RSS_PRINTERROR = "true"; }
if (!process.env.HUBOT_RSS_IRCCOLORS) { process.env.HUBOT_RSS_IRCCOLORS = "false"; }
if (!process.env.HUBOT_RSS_LIMIT_ON_ADD) { process.env.HUBOT_RSS_LIMIT_ON_ADD = 5; }
if (!process.env.HUBOT_RSS_DUMP_USERS) { process.env.HUBOT_RSS_DUMP_USERS = ""; }

module.exports = function(robot) {

    const logger = {
        info(msg) {
            if (debug.enabled) { return debug(msg); }
            if (typeof msg !== 'string') { msg = JSON.stringify(msg); }
            return robot.logger.info(`${debug.namespace}: ${msg}`);
        },
        error(msg) {
            if (debug.enabled) { return debug(msg); }
            if (typeof msg !== 'string') { msg = JSON.stringify(msg); }
            return robot.logger.error(`${debug.namespace}: ${msg}`);
        }
    };

    const send_queue = [];
    const send = (envelope, body) => send_queue.push({envelope, body});

    const getRoom = function(msg) {
        switch (robot.adapterName) {
            case 'hipchat':
                return msg.message.user.reply_to;
            default:
                return msg.message.room;
        }
    };

    setInterval(function() {
            if (typeof robot.send !== 'function') { return; }
            if (send_queue.length < 1) { return; }
            const msg = send_queue.shift();
            try {
                return robot.send(msg.envelope, msg.body);
            } catch (err) {
                logger.error(`Error on sending to room: \"${room}\"`);
                return logger.error(err);
            }
        }
        , 2000);

    const checker = new RSSChecker(robot);

    //# wait until connect redis
    robot.brain.once('loaded', function() {
        var run = function(opts) {
            logger.info("checker start");
            return checker.check(opts)
                .then(function() {
                        logger.info(`wait ${process.env.HUBOT_RSS_INTERVAL} seconds`);
                        return setTimeout(run, 1000 * process.env.HUBOT_RSS_INTERVAL);
                    }
                    , function(err) {
                        logger.error(err);
                        logger.info(`wait ${process.env.HUBOT_RSS_INTERVAL} seconds`);
                        return setTimeout(run, 1000 * process.env.HUBOT_RSS_INTERVAL);
                    });
        };

        return run();
    });


    const last_state_is_error = {};

    checker.on('new entry', function(entry) {
        last_state_is_error[entry.feed.url] = false;
        return (() => {
            const result = [];
            const object = checker.getAllFeeds();
            for (let room in object) {
                const feeds = object[room];
                if ((room !== entry.args.room) &&
                    _.includes(feeds, entry.feed.url)) {
                    logger.info(`${entry.title} ${entry.url} => ${room}`);
                    result.push(send({room}, entry.toString()));
                } else {
                    result.push(undefined);
                }
            }
            return result;
        })();
    });

    checker.on('error', function(err) {
        logger.error(err);
        if (process.env.HUBOT_RSS_PRINTERROR !== "true") {
            return;
        }
        if (last_state_is_error[err.feed.url]) {  // reduce error notify
            return;
        }
        last_state_is_error[err.feed.url] = true;
        return (() => {
            const result = [];
            const object = checker.getAllFeeds();
            for (let room in object) {
                const feeds = object[room];
                if (_.includes(feeds, err.feed.url)) {
                    result.push(send({room}, `[ERROR] ${err.feed.url} - ${err.error.message || err.error}`));
                } else {
                    result.push(undefined);
                }
            }
            return result;
        })();
    });

    robot.respond(/rss\s+(add|register)\s+(https?:\/\/[^\s]+)$/im, function(msg) {
        const url = msg.match[2].trim();
        last_state_is_error[url] = false;
        logger.info(`add ${url}`);
        const room = getRoom(msg);
        return checker.addFeed(room, url)
            .then(res =>
                new Promise(function(resolve) {
                    msg.send(res);
                    return resolve(url);
                })).then(url => checker.fetch({url, room}))
            .then(function(entries) {
                    const entry_limit =
                        process.env.HUBOT_RSS_LIMIT_ON_ADD === 'false' ?
                            entries.length
                            :
                            process.env.HUBOT_RSS_LIMIT_ON_ADD - 0;
                    for (let entry of Array.from(entries.splice(0, entry_limit))) {
                        send({room}, entry.toString());
                    }
                    if (entries.length > 0) {
                        return send({room},
                            `${process.env.HUBOT_RSS_HEADER} ${entries.length} entries has been omitted`);
                    }
                }
                , function(err) {
                    msg.send(`[ERROR] ${err}`);
                    if (err.message !== 'Not a feed') { return; }
                    return checker.deleteFeed(room, url)
                        .then(() => FindRSS(url)).then(function(feeds) {
                            if ((feeds != null ? feeds.length : undefined) < 1) { return; }
                            return msg.send(_.flatten([
                                    `found some Feeds from ${url}`,
                                    feeds.map(i => ` * ${i.url}`)
                                ]).join('\n')
                            );
                        });
                }).catch(function(err) {
                msg.send(`[ERROR] ${err}`);
                return logger.error(err.stack);
            });
    });


    robot.respond(/rss\s+delete\s+(https?:\/\/[^\s]+)$/im, function(msg) {
        const url = msg.match[1].trim();
        logger.info(`delete ${url}`);
        return checker.deleteFeed(getRoom(msg), url)
            .then(res => msg.send(res)).catch(function(err) {
                msg.send(err);
                return logger.error(err.stack);
            });
    });

    robot.respond(/rss\s+delete\s+#([^\s]+)$/im, function(msg) {
        const room = msg.match[1].trim();
        logger.info(`delete #${room}`);
        return checker.deleteRoom(room, msg.message.room, msg.message.user.name)
            .then(res => msg.send(res)).catch(function(err) {
                msg.send(err);
                return logger.error(err.stack);
            });
    });

    robot.respond(/rss\s+list$/i, function(msg) {
        const feeds = checker.getFeeds(getRoom(msg));
        if (feeds.length < 1) {
            return msg.send("nothing");
        } else {
            return msg.send(feeds.join("\n"));
        }
    });

    robot.respond(/rss\s+version$/i, msg => msg.send(`Moin, this is Rolf (${package_json.version})`));

    return robot.respond(/rss dump$/i, function(msg) {
        let needle;
        if ((needle = msg.message.user.name, Array.from(process.env.HUBOT_RSS_DUMP_USERS.split(",")).includes(needle))) {
            const feeds = checker.getAllFeeds();
            if (process.env.HUBOT_RSS_PRINTMARKDOWN === "true") {
                return msg.send(`\`\`\`${JSON.stringify(feeds, null, 2)}\`\`\``);
            } else {
                return msg.send(JSON.stringify(feeds, null, 2));
            }
        } else {
            return msg.send("not allowed");
        }
    });
};
