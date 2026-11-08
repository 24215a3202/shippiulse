import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/client.js';
import { HttpError } from '../auth/auth-errors.js';
import { requireAuth, requireCsrf, requireRole } from '../auth/auth-middleware.js';
import { publishRealtime } from '../../realtime/socket-server.js';
import { scanForExceptions } from './exception-service.js';

const router = Router();
const statuses = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED'];
const types = ['OVERDUE_DELIVERY', 'MISSING_GPS', 'ROUTE_DEVIATION', 'DELAYED_PICKUP', 'MISSED_STOP', 'VEHICLE_INACTIVE'];
const severities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const listSchema = z.object({
  status: z.enum(statuses).optional(),
  type: z.enum(types).optional(),
  severity: z.enum(severities).optional(),
  shipmentId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const updateSchema = z.object({
  status: z.enum(['ACKNOWLEDGED', 'RESOLVED', 'DISMISSED']).optional(),
  assignedTo: z.uuid().nullable().optional(),
  resolutionNotes: z.string().trim().min(3).max(1000).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0)
  .refine((value) => !['RESOLVED', 'DISMISSED'].includes(value.status) || Boolean(value.resolutionNotes), { path: ['resolutionNotes'], message: 'Add resolution notes to close this exception' });

function validationError(response, error) {
  return response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Check the submitted fields and try again', fields: error.flatten().fieldErrors } });
}

router.use(requireAuth);

router.get('/', async (request, response) => {
  const parsed = listSchema.safeParse(request.query);
  if (!parsed.success) return validationError(response, parsed.error);
  const values = [request.auth.organizationId];
  const where = ['e.organization_id=$1'];
  if (request.auth.role === 'DRIVER') { values.push(request.auth.userId); where.push(`s.driver_id=$${values.length}`); }
  if (parsed.data.status) { values.push(parsed.data.status); where.push(`e.status=$${values.length}`); }
  else where.push("e.status IN ('OPEN','ACKNOWLEDGED')");
  if (parsed.data.type) { values.push(parsed.data.type); where.push(`e.type=$${values.length}`); }
  if (parsed.data.severity) { values.push(parsed.data.severity); where.push(`e.severity=$${values.length}`); }
  if (parsed.data.shipmentId) { values.push(parsed.data.shipmentId); where.push(`e.shipment_id=$${values.length}`); }
  values.push(parsed.data.limit);
  const { rows } = await pool.query(`SELECT e.id,e.shipment_id AS "shipmentId",s.tracking_number AS "trackingNumber",
      e.type,e.severity,e.status,e.condition_key AS "conditionKey",e.description,e.metadata,
      e.detected_at AS "detectedAt",e.last_seen_at AS "lastSeenAt",e.resolved_at AS "resolvedAt",e.escalated_at AS "escalatedAt",
      e.assigned_to AS "assignedTo",assignee.name AS "assignedName",e.resolution_notes AS "resolutionNotes",
      e.created_at AS "createdAt",e.updated_at AS "updatedAt"
    FROM shipment_exceptions e JOIN shipments s ON s.id=e.shipment_id
    LEFT JOIN users assignee ON assignee.id=e.assigned_to AND assignee.organization_id=e.organization_id
    WHERE ${where.join(' AND ')} ORDER BY CASE e.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
      e.detected_at DESC LIMIT $${values.length}`, values);
  response.json({ exceptions: rows });
});

router.post('/scan', requireRole('ORG_ADMIN', 'DISPATCHER', 'SUPER_ADMIN'), requireCsrf, async (request, response) => {
  const result = await scanForExceptions(request.app.get('io'));
  response.json({ scan: result });
});

router.patch('/:exceptionId', requireRole('ORG_ADMIN', 'DISPATCHER', 'SUPER_ADMIN'), requireCsrf, async (request, response) => {
  if (!z.uuid().safeParse(request.params.exceptionId).success) throw new HttpError(404, 'EXCEPTION_NOT_FOUND', 'Exception not found');
  const parsed = updateSchema.safeParse(request.body);
  if (!parsed.success) return validationError(response, parsed.error);
  const input = parsed.data;
  const client = await pool.connect();
  let updated;
  try {
    await client.query('BEGIN');
    const found = await client.query(`SELECT * FROM shipment_exceptions WHERE id=$1 AND organization_id=$2 FOR UPDATE`, [request.params.exceptionId, request.auth.organizationId]);
    const exception = found.rows[0];
    if (!exception) throw new HttpError(404, 'EXCEPTION_NOT_FOUND', 'Exception not found');
    if (input.status && ['RESOLVED', 'DISMISSED'].includes(exception.status)) {
      throw new HttpError(409, 'EXCEPTION_ALREADY_CLOSED', 'A closed exception cannot be reopened');
    }
    if (input.assignedTo) {
      const assignee = await client.query(`SELECT id FROM users WHERE id=$1 AND organization_id=$2 AND status='ACTIVE' AND role IN ('ORG_ADMIN','DISPATCHER','SUPER_ADMIN')`, [input.assignedTo, request.auth.organizationId]);
      if (!assignee.rowCount) throw new HttpError(400, 'INVALID_ASSIGNEE', 'Choose an active administrator or dispatcher from your organization');
    }
    const nextStatus = input.status ?? exception.status;
    const assignedTo = Object.hasOwn(input, 'assignedTo') ? input.assignedTo : exception.assigned_to;
    const resolutionNotes = Object.hasOwn(input, 'resolutionNotes') ? input.resolutionNotes : exception.resolution_notes;
    const resolvedAt = ['RESOLVED', 'DISMISSED'].includes(nextStatus) ? new Date() : null;
    const result = await client.query(`UPDATE shipment_exceptions SET status=$2,assigned_to=$3,resolution_notes=$4,
      resolved_at=$5,updated_at=now() WHERE id=$1 RETURNING id,organization_id AS "organizationId",shipment_id AS "shipmentId",
      type,severity,status,description,assigned_to AS "assignedTo",resolution_notes AS "resolutionNotes",
      resolved_at AS "resolvedAt",updated_at AS "updatedAt"`,
    [exception.id, nextStatus, assignedTo, resolutionNotes, resolvedAt]);
    updated = result.rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
  publishRealtime(request.app.get('io'), updated.organizationId, updated.shipmentId, 'exception:updated', updated);
  response.json({ exception: updated });
});

export const exceptionsRouter = router;
