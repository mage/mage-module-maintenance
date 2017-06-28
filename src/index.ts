import * as fs from 'fs'
import * as http from 'http'
import * as path from 'path'
import * as mage from 'mage'

/**
 * Details regarding the current maintenance
 *
 * @export
 * @interface IMaintenanceDetails
 */
export interface IMaintenanceDetails {
  start: number
  end: number
  message: string
}

/**
 * Command
 *
 * @export
 * @interface ICommand
 */
export interface ICommand {
  name: string
  params: { [name: string]: any }
}

/**
 * Command batch
 *
 * @export
 * @interface ICommandBatch
 */
export interface ICommandBatch {
  req: http.IncomingMessage
  commands: ICommand[]
}

/**
 * Load all user commands
 *
 * @export
 * @param {*} exports
 */
export function loadUserCommands() {
  const userCommands: any = {}

  mage.listModules().forEach((moduleName: string) => {
    const modulePath = mage.getModulePath(moduleName)
    const moduleUserCommandsPath = path.join(modulePath, 'usercommands')
    let moduleUserCommandFiles

    try {
      moduleUserCommandFiles = fs.readdirSync(moduleUserCommandsPath)
    } catch (error) {
      if (error.code === 'ENOENT') {
        return
      }

      throw error
    }

    moduleUserCommandFiles.forEach(function (file) {
      const userCommandPath = path.join(moduleUserCommandsPath, file)
      const pathInfo = path.parse(userCommandPath)
      const userCommandName = pathInfo.name

      // Skip all files but TypeScript source files
      if (pathInfo.ext !== '.ts' && pathInfo.ext !== '.js') {
        return
      }

      userCommands[`${moduleName}.${userCommandName}`] = require(userCommandPath)
    })
  })

  return userCommands
}

// User commands key-value map
const USER_COMMANDS = loadUserCommands()

// Session key
const MAINTENANCE_SESSION_KEY = 'MAINTENANCE_HAS_ACCESS'

/**
 * Execute the command hook
 *
 * This will essentially substitute any user commands
 * which is not allowed to execute with a user command
 * returning the status of the maintenance instead.
 *
 * @param {mage.core.IState} state
 * @param {*} _data
 * @param {ICommandBatch} batch
 * @param {IHookCallback} callback
 * @memberof AbstractMaintenanceModule
 */
function executeHook(state: mage.core.IState, _data: any, batch: ICommandBatch, callback: () => void) {
  batch.commands = batch.commands.map((command) => {
    // Whitelist all commands on the maintenance module
    if (command.name.substring(0, 12) === 'maintenance.') {
      return command
    }

    // Whitelist commands based on the user's session
    if (state.session && state.session.getData(MAINTENANCE_SESSION_KEY)) {
      return command
    }

    // Whitelist commands marked with @OnMaintenance(AllowAccess) decorator
    if (USER_COMMANDS[command.name] && USER_COMMANDS[command.name]._OnMaintenance) {
      return command
    }

    // Redirect all other commands to the status error
    return { name: 'maintenance.status', params: {}}
  })

  callback()
}

/**
 * OnMaintenance decorator
 *
 * This will mark the user command as valid or explicitly invalid
 *
 * @export
 * @param {boolean} isAllowed
 * @returns
 */
export function OnMaintenance(isAllowed: boolean) {
  return function (target: any, key: string) {
    if (key !== 'execute') {
      throw new Error('OnMaintenance must be placed over a user command\'s execute method')
    }

    target._OnMaintenance = isAllowed
  }
}

/**
 * Explicitly allow a user command to execute
 * during maintenance
 */
export const AllowAccess = true

/**
 * Explicitly disallow a user command to execute
 * during maintenance
 */
export const DenyAccess = false

/**
 * Mark a user as allowed to call user commands
 * even during maintenances
 *
 * @export
 * @param {mage.core.IState} state
 */
export function AllowUser(state: mage.core.IState) {
  // Todo: create session if does not exist (log in anonymous???)
  if (!state.session) {
    throw new Error('Session does not exist for user')
  }

  state.session.setData(MAINTENANCE_SESSION_KEY, true)
}

/**
 * Mark a user as not allowed to call user commands
 * even during maintenances
 *
 * By default, this will also throw a maintenance error;
 * you may use the shouldThrow parameter to disable this behavior.
 *
 * @export
 * @param {mage.core.IState} state
 */
export function DenyUser(state: mage.core.IState, shouldThrow: boolean = true) {
  if (state.session) {
    state.session.delData(MAINTENANCE_SESSION_KEY)
  }

  // todo: review what error we are returning!
  if (shouldThrow) {
    throw new Error('oh noes maintenance')
  }
}

/**
 * msgServer reference, and constants for messages
 * being broadcasted across the system
 */
const msgServer = mage.core.msgServer
const MAINTENANCE_UPDATE_EVENT = 'maintenance'
const MAINTENANCE_EVENT_START = 'start'
const MAINTENANCE_EVENT_END = 'end'

/**
 * Abstract class used to create maintenance modules
 *
 * @export
 * @abstract
 * @class AbstractMaintenanceModule
 */
export abstract class AbstractMaintenanceModule {
  /**
   * You may also access the following helpers directly from
   * this module, but we recommend accessing them from the created
   * module instead, so to keep your code clear.
   *
   * @memberof AbstractMaintenanceModule
   */
  public OnMaintenance = OnMaintenance
  public AllowAccess = AllowAccess
  public AllowUser = AllowUser
  public DenyUser =  DenyUser

  /**
   * Details object; set during maintenance, null otherwise
   *
   * @type {IMaintenanceDetails}@memberof AbstractMaintenanceModule
   */
  public details?: IMaintenanceDetails

  /**
   * Whitelisted user commands
   *
   * By default, all user commands are filtered
   * during maintenance; we will push in here
   *
   * @abstract
   * @param {mage.core.IState} state
   * @returns {Promise<IMaintenanceDetails>}
   * @memberof AbstractMaintenanceModule
   */

  /**
   * The load method needs to be defined in the inheriting class;
   * its role is to read the current maintenance status from
   * persistent storage when needed (generally upon starting
   * the MAGE server).
   *
   * @abstract
   * @param {mage.core.IState} state
   * @returns {IMaintenanceDetails}
   * @memberof AbstractMaintenanceModule
   */
  public abstract async load(): Promise<IMaintenanceDetails>

  /**
   * The store method needs to be defined in the inheriting class;
   * its role is to store a maintenance message whenever needed, so
   * that it may be read from persistent storage whenever needed.
   *
   * @abstract
   * @param {mage.core.IState} state
   * @param {IMaintenanceDetails} message
   * @returns {string}
   * @memberof AbstractMaintenanceModule
   */
  public abstract async store(message: IMaintenanceDetails): Promise<void>

  /**
   * Setup method called when MAGE is initialized
   *
   * @param {mage.core.IState} state
   * @param {Function} callback
   * @memberof AbstractMaintenanceModule
   */
  public async setup(_state: mage.core.IState, callback: (error?: Error) => void) {
    const core: any = mage.core
    const cmd: any = core.cmd

    // Setup hook
    cmd.registerMessageHook('maintenance', executeHook)

    // Load current status
    this.details = await this.load()

    // Cluster communication - reload when we receive a notification
    msgServer.getMmrpNode().on(`delivery.${MAINTENANCE_UPDATE_EVENT}`, async ({ messages }) => {
      switch (messages[0]) {
        case MAINTENANCE_EVENT_START:
          this.details = await this.load()
          break

        case MAINTENANCE_EVENT_END:
          this.details = undefined
          break
      }
    })

    callback()
  }

  /**
   * Start a maintenance event
   *
   * @param {IMaintenanceDetails} details
   * @memberof AbstractMaintenanceModule
   */
  public async start(details: IMaintenanceDetails) {
    await this.store(details)
    this.notify(MAINTENANCE_EVENT_START)
  }

  /**
   * End the current maintenance
   *
   * @memberof AbstractMaintenanceModule
   */
  public end() {
    this.details = undefined
    this.notify(MAINTENANCE_EVENT_END)
  }

  /**
   * Returns whether the server is currently under maintenance
   *
   * @returns
   * @memberof AbstractMaintenanceModule
   */
  public status() {
    return this.details
  }

  /**
   * Broadcast to all nodes the beginning or end of a maintenance
   *
   * @param message
   */
  private notify(message: 'start' | 'end') {
    // Notify all servers
    const Envelope = msgServer.mmrp.Envelope
    const maintenanceUpdate = new Envelope(MAINTENANCE_UPDATE_EVENT, [message])

    msgServer.getMmrpNode().broadcast(maintenanceUpdate)

    // Notify all users
    const state = new mage.core.State()
    state.broadcast(`maintenance.${message}`, this.details)
  }
}
