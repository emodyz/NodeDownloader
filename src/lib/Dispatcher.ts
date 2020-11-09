import DispatcherEvent from './DispatcherEvent';

export class Dispatcher {
  public events = {};

  dispatch(eventName: string, data) {
    const event = this.events[eventName];
    if (event) {
      event.fire(data);
    }
  }

  on(eventName: string, callback: (data) => void) {
    let event = this.events[eventName];
    if (!event) {
      event = new DispatcherEvent(eventName);
      this.events[eventName] = event;
    }
    event.registerCallback(callback);
  }

  off(eventName: string, callback: (data) => void) {
    const event = this.events[eventName];
    if (event && event.callbacks.indexOf(callback) > -1) {
      event.unregisterCallback(callback);
      if (event.callbacks.length === 0) {
        delete this.events[eventName];
      }
    }
  }
}
