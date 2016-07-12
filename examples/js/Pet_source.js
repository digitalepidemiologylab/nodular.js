function Pet(name) {
    this.name = name;
    this.hello = 'Hello';
}

Pet.prototype.sayWhoYouAre = function() {
    return this.hello + ", I'm " + this.name;
}

module.exports = Pet;