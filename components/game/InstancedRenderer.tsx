import React, { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GameState, Unit, UnitStatus, UnitType, AnimationState, BuildingType, GameObjectType } from '../../types';
import { UNIT_CONFIG, DEATH_ANIMATION_DURATION, COLLISION_DATA } from '../../constants';

const tempObject = new THREE.Object3D();
const tempColor = new THREE.Color();

// Re-usable geometries and materials
const geometries = {
    [UnitType.WORKER]: new THREE.CapsuleGeometry(0.4, 0.5, 32),
    [UnitType.INFANTRY]: new THREE.CylinderGeometry(0.4, 0.5, 1.5),
    [UnitType.ARCHER]: new THREE.ConeGeometry(0.5, 1.4, 8),
    [UnitType.CAVALRY]: new THREE.BoxGeometry(0.6, 0.8, 1.6), // Simplified horse body
    [UnitType.CATAPULT]: new THREE.BoxGeometry(1.5, 0.6, 2.0), // Simplified catapult body
    selectionRing: new THREE.RingGeometry(0.9, 1.05, 32),
    healthBar: new THREE.PlaneGeometry(1, 1),
};

const materials = {
    unit: new THREE.MeshStandardMaterial({ metalness: 0.3, roughness: 0.4 }),
    selectionRing: new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide }),
    healthBarBg: new THREE.MeshBasicMaterial({ color: '#3f3f46', toneMapped: false }),
    healthBarPlayer: new THREE.MeshBasicMaterial({ color: '#22c55e', toneMapped: false }),
    healthBarEnemy: new THREE.MeshBasicMaterial({ color: '#ef4444', toneMapped: false }),
};


const getAnimationState = (unit: Unit): AnimationState => {
    if (unit.isDying) return AnimationState.DYING;
    
    if (unit.status === UnitStatus.ATTACKING && unit.targetId) {
        if (unit.unitType === UnitType.ARCHER || unit.unitType === UnitType.CATAPULT) return AnimationState.ATTACKING_RANGED;
        return AnimationState.ATTACKING_MELEE;
    }
    if (unit.status === UnitStatus.GATHERING && unit.targetId) return AnimationState.GATHERING;
    if (unit.status === UnitStatus.BUILDING && unit.buildTask) return AnimationState.BUILDING;

    if (unit.status === UnitStatus.MOVING || unit.status === UnitStatus.RETURNING || unit.status === UnitStatus.FLEEING || !!unit.path) {
        return AnimationState.WALKING;
    }
    
    return AnimationState.IDLE;
};

// --- Sub-Components for Instanced Rendering ---

const UnitLayer = ({ units, geometry, material }: { units: Unit[], geometry: THREE.BufferGeometry, material: THREE.Material }) => {
    const meshRef = useRef<THREE.InstancedMesh>(null!);
    
    useFrame((state) => {
        if (!meshRef.current) return;
        units.forEach((unit, i) => {
            meshRef.current.getMatrixAt(i, tempObject.matrix);
            tempObject.matrix.decompose(tempObject.position, tempObject.quaternion, tempObject.scale);
            
            // This is a simplified animation logic for position, real logic is in the main component
            tempObject.position.lerp(new THREE.Vector3(unit.position.x, tempObject.position.y, unit.position.z), 0.2);
            
            tempObject.updateMatrix();
            meshRef.current.setMatrixAt(i, tempObject.matrix);
        });
        meshRef.current.instanceMatrix.needsUpdate = true;
    });

    return <instancedMesh ref={meshRef} args={[geometry, material, units.length]} castShadow={false} receiveShadow={false} />
};


export const InstancedRenderer: React.FC<{ gameState: GameState, selectedIds: Set<string> }> = ({ gameState, selectedIds }) => {
    const { camera } = useThree();
    
    const unitMeshes = {
        [UnitType.WORKER]: useRef<THREE.InstancedMesh>(null!),
        [UnitType.INFANTRY]: useRef<THREE.InstancedMesh>(null!),
        [UnitType.ARCHER]: useRef<THREE.InstancedMesh>(null!),
        [UnitType.CAVALRY]: useRef<THREE.InstancedMesh>(null!),
        [UnitType.CATAPULT]: useRef<THREE.InstancedMesh>(null!),
    };
    const selectionRingMesh = useRef<THREE.InstancedMesh>(null!);
    const healthBarBgMesh = useRef<THREE.InstancedMesh>(null!);
    const healthBarFgMesh = useRef<THREE.InstancedMesh>(null!);

    const unitAnimationState = useRef(new Map<string, {
        position: THREE.Vector3,
        quaternion: THREE.Quaternion,
        modelPosition: THREE.Vector3,
        modelQuaternion: THREE.Quaternion,
    }>()).current;
    const deathOrientationMap = useRef(new Map<string, { axis: THREE.Vector3; direction: number }>()).current;

    const getDeathOrientation = (unit: Unit) => {
        let orient = deathOrientationMap.get(unit.id);
        if (!orient) {
            let hash = 0;
            for (let i = 0; i < unit.id.length; i++) {
                hash = (hash * 31 + unit.id.charCodeAt(i)) | 0;
            }
            const angle = ((hash >>> 0) % 360) * (Math.PI / 180);
            const direction = ((hash >>> 8) & 1) === 0 ? 1 : -1;
            const axis = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
            orient = { axis, direction };
            deathOrientationMap.set(unit.id, orient);
        }
        return orient;
    };
    
    const unitsByType = useMemo(() => {
        const result = {
            [UnitType.WORKER]: [] as Unit[],
            [UnitType.INFANTRY]: [] as Unit[],
            [UnitType.ARCHER]: [] as Unit[],
            [UnitType.CAVALRY]: [] as Unit[],
            [UnitType.CATAPULT]: [] as Unit[],
        };
        for (const unit of Object.values(gameState.units)) {
            if (result[unit.unitType]) {
                result[unit.unitType].push(unit);
            }
        }
        return result;
    }, [gameState.units]);

    const selectedObjects = useMemo(() => {
        return gameState.selectedIds
            .map(id => gameState.units[id] || gameState.buildings[id])
            .filter(Boolean);
    }, [gameState.selectedIds, gameState.units, gameState.buildings]);

    const unitsWithHealthBars = useMemo(() => {
        return Object.values(gameState.units).filter(u => u.hp < u.maxHp && u.hp > 0 && !u.isDying);
    }, [gameState.units]);

    useFrame((state, delta) => {
        const dt = Math.min(delta, 0.1);
        const humanPlayer = gameState.players.find(p => p.isHuman);
        const humanTeamId = humanPlayer?.teamId;

        // --- Update All Units ---
        Object.entries(unitsByType).forEach(([type, units]) => {
            const mesh = unitMeshes[type as UnitType].current;
            if (!mesh) return;

            units.forEach((unit, i) => {
                if (!unitAnimationState.has(unit.id)) {
                    unitAnimationState.set(unit.id, {
                        position: new THREE.Vector3(unit.position.x, unit.position.y, unit.position.z),
                        quaternion: new THREE.Quaternion(),
                        modelPosition: new THREE.Vector3(),
                        modelQuaternion: new THREE.Quaternion(),
                    });
                }
                const anim = unitAnimationState.get(unit.id)!;
                const animationState = getAnimationState(unit);

                 // Dying Animation
                if (animationState === AnimationState.DYING) {
                    const deathTime = unit.deathTime || 0;
                    const elapsedTime = Date.now() - deathTime;
                    const FALL_DURATION = 900;
                    const SINK_DURATION = Math.max(400, DEATH_ANIMATION_DURATION - FALL_DURATION);
                    const { axis: fallAxis, direction: fallDirection } = getDeathOrientation(unit);
                    const fallAngle = fallDirection * (Math.PI / 2);

                    if (elapsedTime <= FALL_DURATION) {
                        const fallProgress = elapsedTime / FALL_DURATION;
                        anim.modelQuaternion.setFromAxisAngle(fallAxis, fallAngle * fallProgress);
                    } else {
                        anim.modelQuaternion.setFromAxisAngle(fallAxis, fallAngle);
                        const sinkProgress = Math.min((elapsedTime - FALL_DURATION) / SINK_DURATION, 1);
                        anim.position.y = THREE.MathUtils.lerp(0, -2.4, sinkProgress);
                    }
                } else {
                    anim.position.y = 0; // Ensure alive units are on the ground
                    deathOrientationMap.delete(unit.id);
                }

                // Position Interpolation
                const positionLerpFactor = 1 - Math.exp(-20 * dt);
                anim.position.lerp(new THREE.Vector3(unit.position.x, anim.position.y, unit.position.z), positionLerpFactor);

                // Rotation Interpolation
                let lookAtTargetVec: THREE.Vector3 | null = null;
                if (unit.path && unit.pathIndex !== undefined && unit.pathIndex < unit.path.length) {
                    const waypoint = unit.path[unit.pathIndex];
                    lookAtTargetVec = new THREE.Vector3(waypoint.x, 0, waypoint.z);
                } else if (unit.pathTarget) {
                    lookAtTargetVec = new THREE.Vector3(unit.pathTarget.x, 0, unit.pathTarget.z);
                } else if (unit.targetId) {
                     const target = gameState.units[unit.targetId] || gameState.buildings[unit.targetId] || gameState.resourcesNodes[unit.targetId];
                     if (target) lookAtTargetVec = new THREE.Vector3(target.position.x, 0, target.position.z);
                }
                
                if (lookAtTargetVec) {
                    const direction = new THREE.Vector3().subVectors(lookAtTargetVec, anim.position);
                    if (direction.lengthSq() > 0.001) {
                        const angle = Math.atan2(direction.x, direction.z);
                        const targetQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
                        const rotationSlerpFactor = 1 - Math.exp(-15 * dt);
                        anim.quaternion.slerp(targetQuaternion, rotationSlerpFactor);
                    }
                }

                // Model Animation (relative to unit)
                anim.modelPosition.set(0, 0, 0);
                anim.modelQuaternion.set(0, 0, 0, 1);
                
                if(animationState !== AnimationState.DYING) {
                    switch (animationState) {
                        case AnimationState.WALKING:
                            anim.modelQuaternion.setFromEuler(new THREE.Euler(0, 0, Math.sin(state.clock.elapsedTime * 14) * 0.25));
                            break;
                        case AnimationState.GATHERING:
                            const gatherProgress = (unit.gatherTimer || 0) / UNIT_CONFIG[UnitType.WORKER].gatherTime;
                            anim.modelPosition.z = Math.sin(gatherProgress * Math.PI) * 0.8;
                            break;
                        case AnimationState.ATTACKING_MELEE:
                            if(unit.attackCooldown && unit.attackCooldown > 0) {
                                const cooldownProgress = 1 - (unit.attackCooldown / (1 / unit.attackSpeed));
                                anim.modelPosition.z = Math.sin(cooldownProgress * Math.PI) * 0.8;
                            }
                            break;
                        case AnimationState.BUILDING:
                            const buildProgress = (unit.buildTimer || 0) / 0.5; // Build tick is 0.5s
                            anim.modelPosition.z = Math.sin(buildProgress * Math.PI) * 0.3; // Hammering motion
                            break;
                    }
                }
                
                // Set matrix
                const modelMatrix = new THREE.Matrix4().compose(anim.modelPosition, anim.modelQuaternion, new THREE.Vector3(1, 1, 1));
                const instanceMatrix = new THREE.Matrix4().compose(anim.position, anim.quaternion, new THREE.Vector3(1, 1, 1));
                tempObject.matrix.multiplyMatrices(instanceMatrix, modelMatrix);
                
                // Adjust position for geometry pivot
                tempObject.matrix.multiply(new THREE.Matrix4().makeTranslation(0, 0.75, 0));
                
                mesh.setMatrixAt(i, tempObject.matrix);

                // Set color
                const owner = gameState.players[unit.playerId];
                const baseColor = tempColor.set(owner.color);
                mesh.setColorAt(i, selectedIds.has(unit.id) ? baseColor.multiplyScalar(1.5) : baseColor);
            });
            mesh.instanceMatrix.needsUpdate = true;
            if(mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        });
        
        // --- Update Selection Rings ---
        if (selectionRingMesh.current) {
            selectedObjects.forEach((obj, i) => {
                let scale = 1.25;
                if (obj.type === GameObjectType.BUILDING) {
                    const size = COLLISION_DATA.BUILDINGS[obj.buildingType];
                    scale = Math.max(size.width, size.depth) * 0.7;
                } else if (obj.type === GameObjectType.UNIT && obj.unitType === UnitType.CATAPULT) {
                    scale = 1.5;
                }
                tempObject.position.set(obj.position.x, 0.1, obj.position.z);
                tempObject.rotation.set(-Math.PI / 2, 0, 0);
                tempObject.scale.set(scale, scale, scale);
                tempObject.updateMatrix();
                selectionRingMesh.current!.setMatrixAt(i, tempObject.matrix);
                const owner = gameState.players[obj.playerId!];
                let ringColor = '#ff4f4f';
                if (owner) {
                    if (humanPlayer && owner.id === humanPlayer.id) {
                        ringColor = '#32ff6e';
                    } else if (humanTeamId && owner.teamId === humanTeamId && owner.id !== humanPlayer?.id) {
                        ringColor = '#ffd966';
                    }
                }
                selectionRingMesh.current!.setColorAt(i, tempColor.set(ringColor));
            });
            selectionRingMesh.current.instanceMatrix.needsUpdate = true;
            if(selectionRingMesh.current.instanceColor) selectionRingMesh.current.instanceColor.needsUpdate = true;
        }

        // --- Update Health Bars ---
        if(healthBarBgMesh.current && healthBarFgMesh.current) {
            const HEALTHBAR_WIDTH = 1.2;
            const HEALTHBAR_HEIGHT = 0.15;
            const HEALTHBAR_Y_OFFSET = 2.0;
            
            unitsWithHealthBars.forEach((unit, i) => {
                const hpPercentage = unit.hp / unit.maxHp;
                const owner = gameState.players[unit.playerId];
                
                // Background
                tempObject.position.set(unit.position.x, HEALTHBAR_Y_OFFSET, unit.position.z);
                tempObject.quaternion.copy(camera.quaternion);
                tempObject.scale.set(HEALTHBAR_WIDTH, HEALTHBAR_HEIGHT, 1);
                tempObject.updateMatrix();
                healthBarBgMesh.current!.setMatrixAt(i, tempObject.matrix);

                // Foreground
                const fgMatrix = tempObject.matrix.clone();
                const offsetMatrix = new THREE.Matrix4().makeTranslation(-(1 - hpPercentage) * HEALTHBAR_WIDTH / 2, 0, 0.01);
                const scaleMatrix = new THREE.Matrix4().makeScale(hpPercentage, 1, 1);
                fgMatrix.multiply(offsetMatrix).multiply(scaleMatrix);
                healthBarFgMesh.current!.setMatrixAt(i, fgMatrix);
                healthBarFgMesh.current!.setColorAt(i, tempColor.set(owner.isHuman ? '#22c55e' : '#ef4444'));
            });

            healthBarBgMesh.current.instanceMatrix.needsUpdate = true;
            healthBarFgMesh.current.instanceMatrix.needsUpdate = true;
            if(healthBarFgMesh.current.instanceColor) healthBarFgMesh.current.instanceColor.needsUpdate = true;
        }

        deathOrientationMap.forEach((_, unitId) => {
            const tracked = gameState.units[unitId];
            if (!tracked || !tracked.isDying) {
                deathOrientationMap.delete(unitId);
            }
        });

    });
    
    return (
        <>
            {Object.entries(unitsByType).map(([type, units]) => (
                <instancedMesh
                    frustumCulled={false}
                    key={type}
                    ref={unitMeshes[type as UnitType]}
                    args={[geometries[type as UnitType], materials.unit, units.length]}
                    count={units.length}
                />
            ))}
            <instancedMesh
                frustumCulled={false}
                ref={selectionRingMesh}
                args={[geometries.selectionRing, materials.selectionRing, selectedObjects.length]}
                count={selectedObjects.length}
            />
            <instancedMesh
                frustumCulled={false}
                ref={healthBarBgMesh}
                args={[geometries.healthBar, materials.healthBarBg, unitsWithHealthBars.length]}
                count={unitsWithHealthBars.length}
            />
            <instancedMesh
                frustumCulled={false}
                ref={healthBarFgMesh}
                args={[geometries.healthBar, null, unitsWithHealthBars.length]}
                count={unitsWithHealthBars.length}
            >
              {/* Material is set per-instance via color */}
              <meshBasicMaterial toneMapped={false} />
            </instancedMesh>
        </>
    );
}
