import React from 'react';
import { useFrame } from '@react-three/fiber';
import { Plane } from '@react-three/drei';
import { GameState, Action, UnitType, UnitStatus, BuildingType, Building, ResourceNode, GameObjectType, Unit } from '../../../types';
import { COLLISION_DATA } from '../../../constants';

// --- Collision Helper Functions ---

const checkAABBCollision = (box1: { minX: number, maxX: number, minZ: number, maxZ: number }, box2: { minX: number, maxX: number, minZ: number, maxZ: number }) => {
    return (
        box1.minX < box2.maxX &&
        box1.maxX > box2.minX &&
        box1.minZ < box2.maxZ &&
        box1.maxZ > box2.minZ
    );
};

const checkAABBCircleCollision = (box: { minX: number, maxX: number, minZ: number, maxZ: number }, circle: { x: number, z: number, radius: number }) => {
    const closestX = Math.max(box.minX, Math.min(circle.x, box.maxX));
    const closestZ = Math.max(box.minZ, Math.min(circle.z, box.maxZ));
    const distanceX = circle.x - closestX;
    const distanceZ = circle.z - closestZ;
    return (distanceX * distanceX + distanceZ * distanceZ) < (circle.radius * circle.radius);
};


export const checkPlacementCollision = (position: {x:number, z:number}, type: BuildingType, buildings: Record<string, Building>, resources: Record<string, ResourceNode>, units: Record<string, Unit>): boolean => {
    const newBuildingSize = COLLISION_DATA.BUILDINGS[type];
    const newBuildingBox = {
        minX: position.x - newBuildingSize.width / 2,
        maxX: position.x + newBuildingSize.width / 2,
        minZ: position.z - newBuildingSize.depth / 2,
        maxZ: position.z + newBuildingSize.depth / 2,
    };

    // Check against other buildings
    for (const building of Object.values(buildings)) {
        const existingBuildingSize = COLLISION_DATA.BUILDINGS[building.buildingType];
        const PADDING = 0.1; // Prevent buildings from being placed exactly touching
        const existingBuildingBox = {
            minX: building.position.x - (existingBuildingSize.width / 2) - PADDING,
            maxX: building.position.x + (existingBuildingSize.width / 2) + PADDING,
            minZ: building.position.z - (existingBuildingSize.depth / 2) - PADDING,
            maxZ: building.position.z + (existingBuildingSize.depth / 2) + PADDING,
        };
        if (checkAABBCollision(newBuildingBox, existingBuildingBox)) {
            return true;
        }
    }

    // Resources do not block placement.
    // for (const resource of Object.values(resources)) {
    //     const resourceData = COLLISION_DATA.RESOURCES[resource.resourceType];
    //     if (checkAABBCircleCollision(newBuildingBox, { x: resource.position.x, z: resource.position.z, radius: resourceData.radius })) {
    //         return true;
    //     }
    // }

    // Check against units
    for (const unit of Object.values(units)) {
        const unitData = COLLISION_DATA.UNITS[unit.unitType];
        if (checkAABBCircleCollision(newBuildingBox, { x: unit.position.x, z: unit.position.z, radius: unitData.radius })) {
            return true;
        }
    }


    return false;
};

type GroundProps = {
    dispatch: React.Dispatch<Action>;
    gameState: GameState;
    onPointerDown: (e: any) => void;
    onPointerMove: (e: any) => void;
    onPointerUp: (e: any) => void;
    onContextMenu: (e: any) => void;
};

export const Ground: React.FC<GroundProps> = ({ dispatch, gameState, onPointerDown, onPointerMove, onPointerUp, onContextMenu }) => {
  // Empty useFrame to ensure R3F module is loaded for JSX augmentation
  useFrame(() => {});

  const handlePointerMove = (e: any) => {
    if (gameState.buildMode) {
      const isColliding = checkPlacementCollision({x: e.point.x, z: e.point.z}, gameState.buildMode.type, gameState.buildings, gameState.resourcesNodes, gameState.units);
      dispatch({ type: 'UPDATE_BUILD_PLACEHOLDER', payload: { position: {x: e.point.x, y: 0, z: e.point.z}, canPlace: !isColliding } });
    }
    onPointerMove(e);
  };

  return (
    <Plane 
      args={[300, 300]} 
      rotation={[-Math.PI / 2, 0, 0]} 
      onPointerDown={onPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={onContextMenu}
    >
      <meshStandardMaterial color="#4A6A44" />
    </Plane>
  );
};