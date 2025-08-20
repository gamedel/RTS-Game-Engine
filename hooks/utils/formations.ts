import * as THREE from 'three';
import { GameState, Unit, UnitStatus } from '../../types';
import { BufferedDispatch } from '../../state/batch';
import { PathfindingManager } from '../utils/pathfinding';

const NEAR_DEST_SNAP_DISTANCE = 18;   // когда центр группы ближе 18u к цели — можно «доприлизать» строй
const MIN_REISSUE_DELTA_SQ = 0.5 * 0.5; // не перезаём приказ, если цель почти не отличается (<0.5u)

export function updateSquadFormations(state: GameState, dispatch: BufferedDispatch) {
  const bySquad = new Map<string, Unit[]>();
  Object.values(state.units).forEach(u => {
    if (u.squadId && !u.isDying) {
      if (!bySquad.has(u.squadId)) bySquad.set(u.squadId, []);
      bySquad.get(u.squadId)!.push(u);
    }
  });

  bySquad.forEach(units => {
    if (units.length < 2) return;

    // ⚠️ Главное: если всем уже выданы персональные конечные точки (ПКМ по земле с красивой раскладкой) — не вмешиваемся.
    const everyoneHasFinal = units.every(u => !!u.finalDestination);
    if (everyoneHasFinal) return;

    // Якорь строя — среднее по finalDestination или, если их нет, по pathTarget
    const dests: THREE.Vector3[] = [];
    for (const u of units) {
      const v = u.finalDestination || u.pathTarget;
      if (v) dests.push(new THREE.Vector3(v.x, 0, v.z));
    }
    if (dests.length === 0) return;

    const anchor = dests
      .reduce((acc, v) => acc.add(v), new THREE.Vector3())
      .multiplyScalar(1 / dests.length);

    // Центр текущей группы
    const center = units
      .reduce((acc, u) => acc.add(new THREE.Vector3(u.position.x, 0, u.position.z)), new THREE.Vector3())
      .multiplyScalar(1 / units.length);

    // Пока далеко от точки назначения — ничего не перестраиваем: пусть просто бегут.
    if (center.distanceTo(anchor) > NEAR_DEST_SNAP_DISTANCE) return;

    // Ориентация строя — по направлению движения к якорю
    const dir = new THREE.Vector3().subVectors(anchor, center).normalize();
    if (!isFinite(dir.x) || !isFinite(dir.z) || dir.lengthSq() < 1e-3) return;
    const right = new THREE.Vector3(-dir.z, 0, dir.x);

    // Простая грид-формация: кол-во колонн и шаг можно подкрутить
    const spacing = 2.6;
    const cols = Math.min(units.length, 6);

    // Стабильный порядок — чтобы слоты не «прыгали»
    const ordered = [...units].sort((a, b) => a.id.localeCompare(b.id));

    ordered.forEach((u, i) => {
      if (u.status === UnitStatus.ATTACKING) return; // атакующих не дёргаем
      if (PathfindingManager.isRequestPending(u.id)) return; // не перебиваем вычисляющийся путь

      const r = Math.floor(i / cols);
      const c = i % cols;

      const slot = anchor.clone()
        .add(dir.clone().multiplyScalar(-r * spacing))
        .add(right.clone().multiplyScalar((c - (cols - 1) / 2) * spacing));

      // Если текущая цель почти совпадает — не перезаписываем приказ
      const current = u.pathTarget || u.targetPosition;
      if (current) {
        const dx = current.x - slot.x;
        const dz = current.z - slot.z;
        if ((dx * dx + dz * dz) < MIN_REISSUE_DELTA_SQ) return;
      }

      // ВАЖНО: сохраняем исходный finalDestination — после местной «подправки»
      // юнит продолжит в ту конечную точку, которую ему выдали изначально (если была).
      dispatch({
        type: 'COMMAND_UNIT',
        payload: {
          unitId: u.id,
          targetPosition: { x: slot.x, y: 0, z: slot.z },
          finalDestination: u.finalDestination,
          squadId: u.squadId,
        }
      });
    });
  });
}