import { GameState, Action } from '../../types';

const TRADE_RATES = {
    BUY_WOOD_GOLD_COST: 20,
    SELL_WOOD_GOLD_GAIN: 5,
    WOOD_AMOUNT: 10,
};

export function tradeReducer(state: GameState, action: Action): GameState {
    switch (action.type) {
        case 'TRADE_RESOURCES': {
            const { playerId, trade } = action.payload;
            const player = state.players[playerId];
            if (!player) return state;

            const resources = player.resources;
            let newGold = resources.gold;
            let newWood = resources.wood;

            if (trade === 'buy_wood') {
                if (resources.gold >= TRADE_RATES.BUY_WOOD_GOLD_COST) {
                    newGold -= TRADE_RATES.BUY_WOOD_GOLD_COST;
                    newWood += TRADE_RATES.WOOD_AMOUNT;
                }
            } else if (trade === 'sell_wood') {
                if (resources.wood >= TRADE_RATES.WOOD_AMOUNT) {
                    newGold += TRADE_RATES.SELL_WOOD_GOLD_GAIN;
                    newWood -= TRADE_RATES.WOOD_AMOUNT;
                }
            }

            const newPlayers = [...state.players];
            newPlayers[playerId] = {
                ...player,
                resources: {
                    gold: newGold,
                    wood: newWood,
                },
            };

            return { ...state, players: newPlayers };
        }
        default:
            return state;
    }
}