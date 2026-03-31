import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as api from './api.js';

const server = new McpServer({
  name: 'devcanvas',
  version: '0.1.0',
});

// ─── Workspaces ─────────────────────────────────────────────────────────────

server.tool(
  'list-workspaces',
  'Lista todos los workspaces de DevCanvas con su ID, nombre y cantidad de sesiones',
  {},
  async () => {
    const workspaces = await api.listWorkspaces();
    const lines = workspaces.map(
      (w) => `${w.name} (${w.id}) — ${w.sessionCount} sesiones`
    );
    return {
      content: [{ type: 'text', text: lines.length ? lines.join('\n') : 'No hay workspaces.' }],
    };
  }
);

// ─── Sessions ───────────────────────────────────────────────────────────────

server.tool(
  'list-sessions',
  'Lista las sesiones de terminal activas en un workspace',
  {
    workspaceId: z.string().describe('ID del workspace'),
  },
  async ({ workspaceId }) => {
    const sessions = await api.listSessions(workspaceId);
    const lines = sessions.map(
      (s) => `${s.name} (${s.id}) — tipo: ${s.type}`
    );
    return {
      content: [{ type: 'text', text: lines.length ? lines.join('\n') : 'No hay sesiones activas.' }],
    };
  }
);

// ─── Tasks: List ────────────────────────────────────────────────────────────

server.tool(
  'list-tasks',
  'Lista todas las tareas del tablero kanban de un workspace. Muestra titulo, estado, descripcion y nota en vivo',
  {
    workspaceId: z.string().describe('ID del workspace'),
  },
  async ({ workspaceId }) => {
    const tasks = await api.listTasks(workspaceId);
    if (!tasks.length) {
      return { content: [{ type: 'text', text: 'No hay tareas en este workspace.' }] };
    }

    const statusEmoji: Record<string, string> = { todo: 'Pendiente', doing: 'En curso', done: 'Hecho' };
    const lines = tasks.map((t) => {
      const parts = [`[${statusEmoji[t.status] ?? t.status}] ${t.title} (${t.id})`];
      if (t.description) parts.push(`  Descripcion: ${t.description}`);
      if (t.liveNote) parts.push(`  Nota: ${t.liveNote}`);
      if (t.workdir) parts.push(`  Workdir: ${t.workdir}`);
      return parts.join('\n');
    });

    return { content: [{ type: 'text', text: lines.join('\n\n') }] };
  }
);

// ─── Tasks: Get ─────────────────────────────────────────────────────────────

server.tool(
  'get-task',
  'Obtiene los detalles completos de una tarea por su ID',
  {
    taskId: z.string().describe('ID de la tarea'),
  },
  async ({ taskId }) => {
    const t = await api.getTask(taskId);
    const detail = [
      `Titulo: ${t.title}`,
      `Estado: ${t.status}`,
      `Descripcion: ${t.description || '(vacio)'}`,
      `Nota en vivo: ${t.liveNote || '(vacio)'}`,
      `Workdir: ${t.workdir || '(no asignado)'}`,
      `Session: ${t.activeSessionId || '(ninguna)'}`,
      `ID: ${t.id}`,
      `Workspace: ${t.workspaceId}`,
    ].join('\n');

    return { content: [{ type: 'text', text: detail }] };
  }
);

// ─── Tasks: Create ──────────────────────────────────────────────────────────

server.tool(
  'create-task',
  'Crea una nueva tarea en el tablero kanban. Aparece en tiempo real en la UI como "Pendiente"',
  {
    workspaceId: z.string().describe('ID del workspace donde crear la tarea'),
    title: z.string().describe('Titulo de la tarea'),
    description: z.string().optional().describe('Descripcion detallada de la tarea'),
    workdir: z.string().optional().describe('Directorio de trabajo asociado a la tarea'),
  },
  async ({ workspaceId, title, description, workdir }) => {
    const task = await api.createTask(workspaceId, title, description, workdir);
    return {
      content: [{
        type: 'text',
        text: `Tarea creada: "${task.title}" (${task.id})\nEstado: Pendiente\nWorkspace: ${task.workspaceId}`,
      }],
    };
  }
);

// ─── Tasks: Update ──────────────────────────────────────────────────────────

server.tool(
  'update-task',
  'Actualiza los campos de una tarea existente (titulo, descripcion, workdir, nota en vivo)',
  {
    taskId: z.string().describe('ID de la tarea a actualizar'),
    title: z.string().optional().describe('Nuevo titulo'),
    description: z.string().optional().describe('Nueva descripcion'),
    workdir: z.string().optional().describe('Nuevo directorio de trabajo'),
    liveNote: z.string().optional().describe('Nota en vivo - estado actual de la tarea'),
  },
  async ({ taskId, title, description, workdir, liveNote }) => {
    const fields: Parameters<typeof api.updateTask>[1] = {};
    if (title !== undefined) fields.title = title;
    if (description !== undefined) fields.description = description;
    if (workdir !== undefined) fields.workdir = workdir;
    if (liveNote !== undefined) fields.liveNote = liveNote;

    const task = await api.updateTask(taskId, fields);
    return {
      content: [{ type: 'text', text: `Tarea actualizada: "${task.title}" (${task.id})` }],
    };
  }
);

// ─── Tasks: Move ────────────────────────────────────────────────────────────

server.tool(
  'move-task',
  'Cambia el estado de una tarea: todo (pendiente), doing (en curso), done (hecho)',
  {
    taskId: z.string().describe('ID de la tarea'),
    status: z.enum(['todo', 'doing', 'done']).describe('Nuevo estado: todo, doing, o done'),
  },
  async ({ taskId, status }) => {
    const task = await api.moveTask(taskId, status);
    const labels: Record<string, string> = { todo: 'Pendiente', doing: 'En curso', done: 'Hecho' };
    return {
      content: [{ type: 'text', text: `"${task.title}" movida a: ${labels[status]}` }],
    };
  }
);

// ─── Tasks: Resolve ─────────────────────────────────────────────────────────

server.tool(
  'resolve-task',
  'Marca una tarea como resuelta (hecha) con una nota opcional de cierre',
  {
    taskId: z.string().describe('ID de la tarea a resolver'),
    note: z.string().optional().describe('Nota de cierre explicando la resolucion'),
  },
  async ({ taskId, note }) => {
    const task = await api.resolveTask(taskId, note);
    return {
      content: [{ type: 'text', text: `Tarea resuelta: "${task.title}"${note ? ` — ${note}` : ''}` }],
    };
  }
);

// ─── Tasks: Delete ──────────────────────────────────────────────────────────

server.tool(
  'delete-task',
  'Elimina permanentemente una tarea del tablero',
  {
    taskId: z.string().describe('ID de la tarea a eliminar'),
  },
  async ({ taskId }) => {
    await api.deleteTask(taskId);
    return {
      content: [{ type: 'text', text: `Tarea ${taskId} eliminada.` }],
    };
  }
);

// ─── Tasks: Activity ────────────────────────────────────────────────────────

server.tool(
  'add-task-activity',
  'Agrega una actualizacion o comentario a una tarea. Se muestra en el historial de actividad',
  {
    taskId: z.string().describe('ID de la tarea'),
    message: z.string().describe('Mensaje de la actualizacion'),
  },
  async ({ taskId, message }) => {
    const activity = await api.addTaskActivity(taskId, message);
    return {
      content: [{ type: 'text', text: `Actividad registrada en tarea ${taskId}: "${activity.message}"` }],
    };
  }
);

server.tool(
  'get-task-activity',
  'Obtiene el historial de actividad de una tarea',
  {
    taskId: z.string().describe('ID de la tarea'),
    limit: z.number().optional().describe('Cantidad maxima de entradas (default: 30)'),
  },
  async ({ taskId, limit }) => {
    const activities = await api.getTaskActivity(taskId, limit ?? 30);
    if (!activities.length) {
      return { content: [{ type: 'text', text: 'No hay actividad registrada.' }] };
    }

    const lines = activities.map(
      (a) => `[${a.actorLabel}] ${a.message} (${new Date(a.createdAt).toLocaleString('es')})`
    );
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// ─── Health ─────────────────────────────────────────────────────────────────

server.tool(
  'health-check',
  'Verifica si el backend de DevCanvas esta activo y funcionando',
  {},
  async () => {
    try {
      const health = await api.healthCheck();
      return {
        content: [{
          type: 'text',
          text: `Backend: ${health.ok ? 'OK' : 'ERROR'}\nTmux: ${health.tmux ? 'disponible' : 'no disponible'}`,
        }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{
          type: 'text',
          text: `Backend no disponible: ${err instanceof Error ? err.message : String(err)}`,
        }],
      };
    }
  }
);

// ─── Start ──────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP server failed to start:', err);
  process.exit(1);
});
