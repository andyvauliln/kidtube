// The background part of every app (core/background/apps.js says what a part has). main.js registers them.
// A new app adds its part here and its entry in registry.js.
import kidtube from './kidtube/background/index.js';
import instagram from './instagram/background/index.js';

export default [kidtube, instagram];
