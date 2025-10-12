import { GameState, Action, UnitType, BuildingType } from '../../types';
import { COMMAND_MARKER_DURATION, EXPLOSION_MARKER_DURATION, GOLD_MINE_DEPLETE_DURATION, BUILDING_COLLAPSE_DURATION } from '../../constants';
import { BufferedDispatch } from '../../state/batch';

const TREE_REMOVE_DELAY = 2000; // ms
const FLOATING_TEXT_DURATION = 2000; // ms

export const processWorldLogic = (state: GameState, delta: number, dispatch: BufferedDispatch) => {
    const { resourcesNodes, commandMarkers, explosionMarkers, floatingTexts } = state;
    const buildingMap = state.buildings;
    const now = Date.now();

    // --- Resource logic (remove fallen trees and depleted mines) ---
    if (resourcesNodes) {
        Object.values(resourcesNodes).forEach(node => {
            if (node.isFalling && node.fallStartTime && (now - node.fallStartTime > TREE_REMOVE_DELAY)) {
                dispatch({ type: 'REMOVE_RESOURCE_NODE', payload: {id: node.id } });
            }
            if (node.isDepleting && node.depletionStartTime && (now - node.depletionStartTime > GOLD_MINE_DEPLETE_DURATION)) {
                dispatch({ type: 'REMOVE_RESOURCE_NODE', payload: {id: node.id } });
            }
        });
    }

    // --- Command Marker Logic ---
    if (commandMarkers) {
        Object.values(commandMarkers).forEach(marker => {
            if (now - marker.startTime > COMMAND_MARKER_DURATION) {
                dispatch({ type: 'REMOVE_COMMAND_MARKER', payload: marker.id });
            }
        });
    }
    
    // --- Explosion Marker Logic ---
    if (explosionMarkers) {
        Object.values(explosionMarkers).forEach(marker => {
            if (now - marker.startTime > EXPLOSION_MARKER_DURATION) {
                dispatch({ type: 'REMOVE_EXPLOSION_MARKER', payload: marker.id });
            }
        });
    }

    // --- Floating Text Logic ---
    if (floatingTexts) {
        Object.values(floatingTexts).forEach(text => {
            if (now - text.startTime > FLOATING_TEXT_DURATION) {
                dispatch({ type: 'REMOVE_FLOATING_TEXT', payload: text.id });
            }
        });
    }

    if (buildingMap) {
        Object.values(buildingMap).forEach(building => {
            if (building.hp !== undefined && building.hp <= 0 && !building.isCollapsing) {
                dispatch({
                    type: 'UPDATE_BUILDING',
                    payload: { id: building.id, hp: Math.min(building.hp, 0) },
                });
                return;
            }

            if (building.isCollapsing && building.collapseStartedAt && (now - building.collapseStartedAt > BUILDING_COLLAPSE_DURATION)) {
                dispatch({ type: 'REMOVE_BUILDING', payload: { id: building.id } });
            }
        });
    }

    // --- Game Over Conditions ---
    if (state.gameStatus === 'playing') {
        const humanPlayer = state.players.find(p => p.isHuman);
        if (!humanPlayer) return;

        const activePlayers = state.players.filter(p => {
            const hasUnits = Object.values(state.units).some(u => u.playerId === p.id);
            const hasBuildings = Object.values(state.buildings).some(b => b.playerId === p.id);
            return hasUnits || hasBuildings;
        });

        const isHumanActive = activePlayers.some(p => p.id === humanPlayer.id);
        if (!isHumanActive) {
            dispatch({ type: 'SET_GAME_STATUS', payload: 'lost' });
            return;
        }

        const humanTeamId = humanPlayer.teamId;
        const isFFA = humanTeamId === '-';

        if (isFFA) {
            if (activePlayers.length === 1 && activePlayers[0].id === humanPlayer.id) {
                dispatch({ type: 'SET_GAME_STATUS', payload: 'won' });
                return;
            }
        } else {
            const hostilePlayersActive = activePlayers.some(p => p.teamId !== humanTeamId);
            if (!hostilePlayersActive) {
                dispatch({ type: 'SET_GAME_STATUS', payload: 'won' });
                return;
            }
        }
    }
};
