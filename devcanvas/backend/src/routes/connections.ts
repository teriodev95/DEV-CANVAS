import { Hono } from 'hono'
import { listSshTargets } from '../services/ssh'

const connections = new Hono()

connections.get('/ssh', (c) => {
  return c.json(listSshTargets())
})

export { connections }
