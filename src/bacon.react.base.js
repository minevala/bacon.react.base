import * as Bacon  from "baconjs"
import * as R from "ramda"
import React  from "react"

// Lifting

export const config = {
  onError: e => {throw e}
}

const nullDispose = {dispose: null}
const nullState = {dispose: null, rendered: null}

class LiftedComponent extends React.Component {
  constructor(props) {
    super(props)
    this.state = nullState
  }
  tryDispose() {
    const {dispose} = this.state
    if (dispose)
      dispose()
  }
  componentWillReceiveProps(nextProps) {
    this.trySubscribe(nextProps)
  }
  componentWillMount() {
    this.trySubscribe(this.props)
  }
  shouldComponentUpdate(np, ns) {
    return ns.rendered !== this.state.rendered
  }
  componentWillUnmount() {
    this.tryDispose()
    this.setState(nullState)
  }
  render() {
    return this.state.rendered
  }
}

const toProperty = obs =>
  obs instanceof Bacon.EventStream ? obs.toProperty() : obs

class FromBacon extends LiftedComponent {
  constructor(props) {
    super(props)
  }
  trySubscribe({bacon}) {
    this.tryDispose()

    this.setState({dispose: bacon.subscribe(ev => {
      if (ev.hasValue()) {
        this.setState({rendered: ev.value()})
      } else if (ev.isError()) {
        config.onError(ev.error)
      } else {
        this.setState(nullDispose)
      }
    })})
  }
}

export const fromBacon = bacon =>
  React.createElement(FromBacon, {bacon})

const combineAsArray = obs =>
  obs.length === 1 ? obs[0].map(x => [x]) : Bacon.combineAsArray(obs)

class FromClass extends LiftedComponent {
  constructor(props) {
    super(props)
  }
  trySubscribe({props}) {
    this.tryDispose()

    const vals = {}
    const obsKeys = []
    const obsStreams = []

    for (const key in props) {
      const val = props[key]
      const keyOut = "mount" === key ? "ref" : key
      if (val instanceof Bacon.Observable) {
        obsKeys.push(keyOut)
        obsStreams.push(val)
      } else if ("children" === key &&
                 val instanceof Array &&
                 val.find(c => c instanceof Bacon.Observable)) {
        obsKeys.push(keyOut)
        obsStreams.push(Bacon.combineAsArray(val))
      } else {
        vals[keyOut] = val
      }
    }

    this.setState({dispose: combineAsArray(obsStreams).subscribe(ev => {
      if (ev.hasValue()) {
        const obsVals = ev.value()
        const props = {}
        let children = null
        for (const key in vals) {
          const val = vals[key]
          if ("children" === key) {children = val} else {props[key] = val}
        }
        for (let i=0, n=obsKeys.length; i<n; ++i) {
          const key = obsKeys[i]
          const val = obsVals[i]
          if ("children" === key) {children = val} else {props[key] = val}
        }
        this.setState({rendered: React.createElement(this.props.Class,
                                                     props,
                                                     children)})
      } else if (ev.isError()) {
        config.onError(ev.error)
      } else {
        this.setState(nullDispose)
      }
    })})
  }
}

export const fromClass =
  Class => props => React.createElement(FromClass, {Class, props})

export const fromClasses = classes => {
  const result = {}
  for (const k in classes)
    result[k] = fromClass(classes[k])
  return result
}

export const fromIds = (ids, fromId) => ids.scan([{}, []], ([oldIds], ids) => {
  const newIds = {}
  const newVs = Array(ids.length)
  for (let i=0, n=ids.length; i<n; ++i) {
    const id = ids[i]
    const k = id.toString()
    if (k in newIds)
      newVs[i] = newIds[k]
    else
      newIds[k] = newVs[i] = k in oldIds ? oldIds[k] : fromId(id)
  }
  return [newIds, newVs]
}).map(s => s[1])

function B() {
  const n = arguments.length
  if (1 === n) {
    const fn = arguments[0]
    return (...xs) => B(fn, ...xs)
  } else {
    for (let i=0; i<n; ++i) {
      const x = arguments[i]
      const c = x && x.constructor
      if (c === Object || c === Array)
        arguments[i] = Bacon.combineTemplate(x)
    }
    if (2 === n) {
      if (arguments[0] instanceof Bacon.Observable)
        return toProperty(arguments[0]).map(arguments[1]).skipDuplicates(R.equals)
      if (arguments[1] instanceof Bacon.Observable)
        return toProperty(arguments[1]).map(arguments[0]).skipDuplicates(R.equals)
    }
    return Bacon.combineWith.apply(Bacon, arguments).skipDuplicates(R.equals)
  }
}

export default B
