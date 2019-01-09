import { useState, useEffect, useReducer } from 'react'

import { Connector, WalletConnectConnector } from './connectors'
import { Connectors, Library, LibraryName } from './types'

interface ReRenderers {
  networkReRenderer   : number
  forceNetworkReRender: Function
  accountReRenderer   : number
  forceAccountReRender: Function
}

export interface Web3Manager {
  web3Initialized: boolean
  web3State      : Web3State
  setConnector   : Function
  activateAccount: Function
  unsetConnector : Function
  reRenderers    : ReRenderers,
}

interface Web3State {
  connectorName?: string,
  library      ?: Library,
  networkId    ?: number,
  account      ?: string | null,
  error         : Error | null
}

const initialWeb3State: Web3State = {
  connectorName: undefined,
  library      : undefined,
  networkId    : undefined,
  account      : undefined,
  error        : null
}

function web3StateReducer (state: any, action: any): Web3State {
  switch (action.type) {
    case 'UPDATE_CONNECTOR_VALUES': {
      const { connectorName, library, networkId, account } = action.payload
      return { connectorName, library, networkId, account, error: null }
    }
    case 'UPDATE_NETWORK_ID':
      return { ...state, networkId: action.payload }
    case 'UPDATE_ACCOUNT':
      return { ...state, account: action.payload }
    case 'UPDATE_ERROR':
      return { ...state, error: action.payload }
    case 'UPDATE_ERROR_WITH_NAME': {
      const { error, connectorName } = action.payload
      return { ...state, error, connectorName }
    }
    case 'RESET':
      return initialWeb3State
    default:
      throw Error('No default case.')
  }
}

export default function useWeb3Manager (connectors: Connectors, libraryName: LibraryName): Web3Manager {
  // keep track of web3 state
  const [web3State, dispatchWeb3State] = useReducer(web3StateReducer, initialWeb3State)
  const web3Initialized: boolean = !!(
    web3State.connectorName &&
    web3State.library &&
    web3State.networkId &&
    web3State.account !== undefined &&
    !web3State.error
  )

  // keep track of active connector
  const activeConnector: Connector | undefined =
    web3State.connectorName ? connectors[web3State.connectorName] : undefined

  // function to set a connector
  async function setConnector (connectorName: string, suppressGlobalError: boolean = true): Promise<void> {
    const validConnectorNames = Object.keys(connectors)
    if (!validConnectorNames.includes(connectorName)) {
      console.error((
        `The passed 'connectorName' parameter ${connectorName} is not recognized.` +
        `Valid values are: ${validConnectorNames.join(', ')}`
      ))
      return
    }

    if (connectorName === web3State.connectorName) {
      console.error(`The ${connectorName} connector is already set.`)
      return
    }

    return initializeConnectorValues(connectorName, suppressGlobalError)
  }

  // function to unset the current connector
  function unsetConnector (): void {
    dispatchWeb3State({ type: 'RESET' })
  }

  // initialize a connector
  async function initializeConnectorValues (connectorName: string, suppressGlobalError: boolean): Promise<void> {
    const connector: Connector = connectors[connectorName]

    try {
      await connector.onActivation()

      const library: Library = await connector.getLibrary(libraryName)

      const networkIdPromise = () => connector.getNetworkId(library)
      const accountPromise = connector.activateAccountImmediately ? () => connector.getAccount(library) : () => null

      await Promise.all([networkIdPromise(), accountPromise()])
        .then(([networkId, account])  => {
          dispatchWeb3State(
            { type: 'UPDATE_CONNECTOR_VALUES', payload: { connectorName, library, networkId, account } }
          )
        })
    } catch (error) {
      if (suppressGlobalError) throw error
      else {
        const processedError = processError(error, connectorName)
        if (processedError) throw processedError
      }
    }
  }

  // process errors. returning undefined indicates that errors should be eaten
  function processError(error: Error, connectorName?: string): Error | undefined {
    if (error.code === WalletConnectConnector.errorCodes.WALLETCONNECT_TIMEOUT) return

    if (connectorName)
      dispatchWeb3State({ type: 'UPDATE_ERROR_WITH_NAME', payload: { error, connectorName } })
    else
      dispatchWeb3State({ type: 'UPDATE_ERROR', payload: error })

    throw error
  }

  // ensure that connectors are cleaned up whenever they're changed
  useEffect(() => { if (activeConnector) return () => activeConnector.onDeactivation() }, [activeConnector])

  // change listeners
  function networkChangedListenerHandler(networkId: number): void {
    dispatchWeb3State({ type: 'UPDATE_NETWORK_ID', payload: networkId })
  }
  function accountsChangedListenerHandler(accounts: string[]): void {
    dispatchWeb3State({ type: 'UPDATE_ACCOUNT', payload: accounts[0] })
  }
  useEffect(() => {
    if (web3Initialized && activeConnector && activeConnector.listenForNetworkChanges) {
      const { ethereum } = window
      if (ethereum && ethereum.on && ethereum.removeListener) {
        ethereum.on('networkChanged', networkChangedListenerHandler)
        return () => ethereum.removeListener('networkChanged', networkChangedListenerHandler)
      }
    }
  }, [web3Initialized, activeConnector, web3State.connectorName])
  useEffect(() => {
    if (web3Initialized && activeConnector && activeConnector.listenForAccountChanges) {
      const { ethereum } = window
      if (ethereum && ethereum.on && ethereum.removeListener) {
        ethereum.on('accountsChanged', accountsChangedListenerHandler)
        return () => ethereum.removeListener('accountsChanged', accountsChangedListenerHandler)
      }
    }
  }, [web3Initialized, activeConnector, web3State.connectorName])

  // export function to manually trigger an account update
  async function activateAccount(suppressGlobalError: boolean = true): Promise<void> {
    if (!web3Initialized) {
      console.error('Calling this function in an uninitialized state is a no-op.')
      return
    }

    if (web3State.account !== null) {
      console.error('Calling this function while an account is active is a no-op.')
      return
    }

    if (!activeConnector || !web3State.library) {
      console.error('Unexpected Error.')
      return
    }

    return activeConnector.getAccount(web3State.library)
      .then(account => dispatchWeb3State({ type: 'UPDATE_ACCOUNT', payload: account }))
      .catch(error => {
        if (suppressGlobalError) throw error
        else {
          const processedError = processError(error)
          if (processedError) throw processedError
        }
      })
  }

  // re renderers
  const [networkReRenderer, setNetworkReRenderer]: [number, Function] = useState(0)
  const [accountReRenderer, setAccountReRenderer]: [number, Function] = useState(0)
  function forceNetworkReRender () { setNetworkReRenderer(networkReRenderer + 1) }
  function forceAccountReRender () { setAccountReRenderer(accountReRenderer + 1) }

  return {
    web3Initialized, web3State,
    setConnector, activateAccount, unsetConnector,
    reRenderers: { networkReRenderer, forceNetworkReRender, accountReRenderer, forceAccountReRender }
  }
}
