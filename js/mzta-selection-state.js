// Selection state belongs to a Thunderbird window, not the whole extension.
export class ChatSelectionState {
    constructor() { this.windows = new Map(); this.generation = 0; }
    state(windowId) {
        if (!this.windows.has(windowId)) this.windows.set(windowId, { generation: 0, timer: null, key: null });
        return this.windows.get(windowId);
    }
    begin(windowId) {
        const state = this.state(windowId);
        clearTimeout(state.timer);
        state.timer = null;
        state.generation = ++this.generation;
        return { windowId, generation: state.generation };
    }
    current(ticket) { return !!ticket && this.windows.get(ticket.windowId)?.generation === ticket.generation; }
    forget(windowId) { clearTimeout(this.windows.get(windowId)?.timer); this.windows.delete(windowId); }
}
