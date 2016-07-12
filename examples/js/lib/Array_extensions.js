Array.prototype.descriptiveText = function () {
    var n = this.length;
    switch (n) {
        case  0: return '[] is an empty array';
        case  1: return JSON.stringify(this) + ' is an array with 1 element';
        default: return JSON.stringify(this) + ' is an array with ' + n + ' elements';
    }
}