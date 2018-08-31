/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
// Data Store for entries

let Entries;
module.exports = (Entries = class Entries {

  constructor(robot) {
    this.robot = robot;
    this.prefix = 'hubot-rss-reader:entry:';
  }

  key(url) {
    return `${this.prefix}${url}`;
  }

  add(url) {
    return this.robot.brain.set(this.key(url), true);
  }

  remove(url) {
    return this.robot.brain.set(this.key(url), false);
  }

  include(url) {
    return this.robot.brain.get(this.key(url));
  }
});
