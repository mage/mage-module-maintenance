mage-module-maintenance
=======================

Module to help you implement a maintenance mode for your game cluster.

This module will help you deal with the following tasks:

  1. Starting and stopping a maintenance
  2. Broadcasting maintenance status messages on start and stop
  3. Customizing the behaviour of your user commands during maintenance
  4. Implementing drain systems to allow current matches to complete
     while disallowing the creationg of new matches

Installation
-------------

```shell
npm install --save mage-module-maintenance
```

Usage
-----

### Module creation

> lib/modules/maintenance/index.ts

```typescript
import maintenance, {
  AbstractMaintenanceModule
} from 'mage-module-maintenance'

class MaintenanceModule extends AbstractMaintenanceModule {
   // Store the maintenance message
   public async store(message: maintenance.IMessage) {
　　　　
   }

   // Load the maintenance status from persistent storage
   public async load() {

   }
}

export default new MaintenanceModule()
```

Then, create the following user commands:

  * start
  * end
  * status

> lib/modules/maintenance/usercommands/start.ts

```typescript
// mage
import * as mage from 'mage'
import MaintenanceModule from '../'

// validation tools
import { Acl } from 'mage-validator'

// User command
export default class {
  @Acl('*')  // You might want to customise this to your need!
  public static async execute(_state: mage.core.IState) {
    return MaintenanceModule.start() // create the same user command for end and status!
  }
}
```

### On the client side

Depending on your client SDK, the behavior may be slightly different. However, you may expect the following
things to happen:

  1. When calling a user command, you will receive a 'maintenance' error automatically to all user commands
  2. Through [Message Stream](https://mage.github.io/mage/api.html#message-stream), you will receive:
    * **maintenance.start**: With a JSON message containing details about the maintenance
    * **maintenance.end**: With a JSON message containing additional details

### User commands decoration

You may want to allow certain user commands to be called during a maintenance;
for instance, you may want to allow users to complete their current match, then
keep track of the number of active match in your admin dashboard and wait until
the count goes to zero before starting your actual maintenance process.

> lib/modules/match/usercommands/someAction.ts

```typescript
// mage
import * as mage from 'mage'
import { OnMaintenance, AllowAccess } from '../../maintenance'

// validation tools
import { Acl } from 'mage-validator'

// User command
export default class {
  @Acl('*')
  @OnMaintenance(AllowAccess)
  public static async execute(state: mage.core.IState) {
    // your command code
  }
}
```

### Per-user access allowance

During your maintenance, you will likely want to allow select 
players to access the game (normally, members of your development team).

> lib/modules/players/usercommands/login.ts

```typescript
// mage
import * as mage from 'mage'
import { OnMaintenance, AllowAccess, AllowUser, DenyUser } from '../../maintenance'

// validation tools
import { Acl } from 'mage-validator'

// User command
export default class {
  @Acl('*')
  @OnMaintenance(AllowAccess)
  public static async execute(state: mage.core.IState) {
    // your login code, then

    if (player.hasMaintenanceAccess) {
      AllowUser(state)
      return player
    }
    
    DenyUser(state)
  }
}
```

You may choose to selectively allow access per user, per user
command; you can also whitelist a user by calling the `AllowUser`
function.

License
-------

MIT
