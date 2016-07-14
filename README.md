# nodular.js

## Attempt to reuse node.js code in a browser

### Live test
If you want to test the code, these examples are available on  
http://nodular.js.s3-website-eu-west-1.amazonaws.com/examples/

### Notice

nodular.js **works when served by a web server only**, because modern browsers won't allow XMLHttpRequest to download a local file. This restriction is motivated by obvious security concerns.


### Preparation

Download and run the compatibility code, that creates a global `_nodularJS_` object:
```html
<script src="https://salathegroup.github.io/nodular.js/nodular.js"></script>
```
Basic setup:
```html
<script>
    // Start time will be useful at the end of the page
    var startTime = new Date();

    // Specify a path prefix on the server for our required scripts
    _nodularJS_.pathPrefix = 'js/';

    // We don't want required scripts to be loaded from the browser cache
    // Might be removed in production
    _nodularJS_.forceDownloads = true;

    // We want to log to the console execution events
    // Remove or change to 0 in production
    _nodularJS_.loglevel = 2;

    // We'll use that to show the source of downloaded JavaScript files
    // This can be used for debug purposes
    _nodularJS_.onmodulestatuschange = function(module) {
        if (module.status == _nodularJS_.ModuleStatus.PREPARING) {
            var source = module.sourceCode();
            var pres = document.getElementsByClassName(module.file().replace(/^\.\//g, ''));
            showSourceCode(source, module.file(), pres);
        }
    }
</script>
```


### "Module" without export

./lib/Array_extensions.js:
```js
Array.prototype.descriptiveText = function () {
    var n = this.length;
    switch (n) {
        case  0: return '[] is an empty array';
        case  1: return JSON.stringify(this) + ' is an array with 1 element';
        default: return JSON.stringify(this) + ' is an array with ' + n + ' elements';
    }
}
```
HTML source:
```html
<script>
    require('lib/Array_extensions.js');

    showOutput([1, 2, 3].descriptiveText());
</script>
```
Output:
```
[1,2,3] is an array with 3 elements
```


### Basic and a bit less basic exports

./Module_export_basic.js:
```js
module.exports = "I'm a basic export";
```
./Module_export_less_basic.js:
```js
module.exports.string = "I'm another export, but a bit less basic one";

module.exports.capitaliseWord = function(word) {
    return word.length > 1 ? word.charAt(0).toUpperCase() + word.substr(1)
                           : word;
};

module.exports.capitalise = function(str) {
    return str.split(' ').map(this.capitaliseWord).join(' ');
};
```
HTML source:
```html
<script>
    const basic_export = require('./Module_export_basic.js');
    const less_basic_export = require('./Module_export_less_basic.js');

    showOutput(basic_export);

    showOutput(less_basic_export.capitalise(less_basic_export.string));
</script>
```
Output:
```
I'm a basic export
I'm Another Export, But a Bit Less Basic One
```


### Exported function

./Pet_source.js:
```js
function Pet(name) {
    this.name = name;
    this.hello = 'Hello';
}

Pet.prototype.sayWhoYouAre = function() {
    return this.hello + ", I'm " + this.name;
}

module.exports = Pet;
```
HTML source:
```html
<script>
    const Pet = require('./Pet_source.js');
    var myPet = new Pet('Johnny');
    showOutput(myPet.sayWhoYouAre());
</script>
```
Output:
```
Hello, I'm Johnny
```


### Multiple requires, re-requires, chained requires and more

./Pet_source.js:
```js
function Pet(name) {
    this.name = name;
    this.hello = 'Hello';
}

Pet.prototype.sayWhoYouAre = function() {
    return this.hello + ", I'm " + this.name;
}

module.exports = Pet;
```
./Dog_source.js:
```js
const Pet = require('Pet_source.js');

function Dog(name) {
    Pet.call(this, name);

    this.hello = 'Waf waf waf';
}

Dog.prototype = new Pet();

module.exports = Dog;
```
./Pet_extensions.js:
```js
const Pet = require('Pet_source.js');

Pet.prototype.shoutWhoYouAre = function() {
    return this.sayWhoYouAre().toUpperCase() + '!!!';
}
```
./Dog_extensions.js:
```js
require('Pet_extensions.js');
const Dog = require('Dog_source.js');

Dog.prototype.bark = Dog.prototype.shoutWhoYouAre;
```
HTML source:
```html
<script>
    // The code before "require" might be executed twice, since we have 2 requires...
    showOutput('Code before require');

    // ...so it's good practice to put all requires at the beginning of the script
    // even if here we need Dog.bark() at the end of the script only
    require('Dog_extensions.js');

    // If we don't want to keep a reference to Dog, we can simply do
    const dog_Brutus = new (require('./Dog_source.js'))('Brutus');

    // Otherwise, let's do it like this
    const Dog = require('./Dog_source.js');
    const dog_Max = new Dog('Max');

    showOutput(dog_Brutus.bark());
    showOutput(dog_Max.bark());
</script>
```
Output:
```
Code before require
Code before require
WAF WAF WAF, I'M BRUTUS!!!
WAF WAF WAF, I'M MAX!!!
```


### Wait until all requires have executed, then require a file that doesn't exist

The error will be clearly shown in the console:
```
Uncaught URIError: ./nosuchfile.js not accessible, status: 404, (required by ./Wrong.js ◀ ./RequireWrong.js ◀ test5_script).
```

./RequireWrong.js:
```js
require('Wrong.js');
```
./Wrong.js:
```js
require('nosuchfile.js');
```
HTML source:
```html
<script id="test5_script">
    // Let's be sure all other scripts have executed,
    // to avoid stopping them with the generated exception.
    // require() "blocks" the script execution until all requires
    // have executed.
    require();

    // Just to show the time it took to load & run all required files
    var elapsed = new Date() - startTime;
    showOutput('Time to execute up to the exception: '
               + elapsed + 'ms ');
    showOutput('(could be faster without debug logs)');

    // Require a file that will throw an exception
    require('./RequireWrong.js');

    // Because of the exception above, the rest of the script won't execute
    showOutput("This won't show in the result box");
</script>
```
Output:
```
Time to execute up to the exception: 193ms
(could be faster without debug logs)
```
