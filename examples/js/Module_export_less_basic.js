module.exports.string = "I'm another export, but a bit less basic one";

module.exports.capitaliseWord = function(word) {
    return word.length > 1 ? word.charAt(0).toUpperCase() + word.substr(1)
                           : word;
};

module.exports.capitalise = function(str) {
    return str.split(' ').map(this.capitaliseWord).join(' ');
};