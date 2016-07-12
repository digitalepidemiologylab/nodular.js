require('Pet_extensions.js');
const Dog = require('Dog_source.js');

Dog.prototype.bark = Dog.prototype.shoutWhoYouAre;
