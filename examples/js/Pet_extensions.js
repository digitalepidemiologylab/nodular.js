const Pet = require('Pet_source.js');

Pet.prototype.shoutWhoYouAre = function() {
    return this.sayWhoYouAre().toUpperCase() + '!!!';
}
