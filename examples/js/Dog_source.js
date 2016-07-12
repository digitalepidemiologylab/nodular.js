const Pet = require('Pet_source.js');

function Dog(name) {
    Pet.call(this, name);

    this.hello = 'Waf waf waf';
}

Dog.prototype = new Pet();

module.exports = Dog;