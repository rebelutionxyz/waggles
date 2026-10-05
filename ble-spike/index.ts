import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App).
// It also ensures that whether loaded in Expo Go or a native (dev-client) build,
// the environment is set up appropriately.
registerRootComponent(App);
