import {
  ServiceCallRequest,
  ServiceCallResponse,
} from '../../lib/homeassistant/types';
import { HassSimulatorConfig, HassSimulation, TimedHassEntity } from './types';
import { HomeAssistant, HassEntity } from './homeassistant';

export class HassSimulator {
  simulationProcessors: SimulationProcessor[] = [];
  hass!: HomeAssistant;

  constructor(
    simulatorConfig: HassSimulatorConfig,
    private hassChanged: (hass: HomeAssistant) => void
  ) {
    this.hass = new HomeAssistant();
    this.hass.callService = this.callService.bind(this);

    for (const simulation of simulatorConfig.simulations) {
      const simulationProcessor = new SimulationProcessor(
        simulation,
        this.hass,
        this.onEntityStatesChanged.bind(this)
      );
      this.simulationProcessors.push(simulationProcessor);
    }
  }

  onEntityStatesChanged(entityStates: HassEntity[]): void {
    for (const entityState of entityStates) {
      this.hass.states[entityState.entity_id] = entityState;
    }

    this.hassChanged(this.hass.clone()); // clone the object!!!
  }

  callService(
    domain: ServiceCallRequest['domain'],
    service: ServiceCallRequest['service'],
    serviceData?: ServiceCallRequest['serviceData']
  ): Promise<ServiceCallResponse> {
    console.log('HassSimulator.callService()', domain, service, serviceData);

    switch (domain) {
      case 'homeassistant':
        switch (service) {
          case 'toggle':
            this.homeAssistantToggle(serviceData as Record<string, unknown>);
            break;
        }
        break;
    }

    const response = {
      context: {
        id: '',
        parent_id: undefined,
        user_id: undefined,
      },
    } as ServiceCallResponse;

    return Promise.resolve(response);
  }

  homeAssistantToggle(data: Record<string, unknown>): void {
    if (data.entity_id) {
      const entityType = (data.entity_id as string).split('.')[0];
      const state = this.hass.states[data.entity_id as string].state;

      let newState: string;

      switch (entityType) {
        case 'switch':
        case 'light':
        case 'binary_sensor':
        case 'sensor':
          newState = state === 'on' ? 'off' : 'on';

          for (const simulationProcessor of this.simulationProcessors) {
            simulationProcessor.updateEntityState(
              data.entity_id as string,
              newState
            );
          }
          break;
      }
    }
  }
}

export class SimulationProcessor {
  currentIndex = 0;
  entities: (string | HassEntity)[] = [];

  constructor(
    private simulation: HassSimulation,
    private hass: HomeAssistant,
    private onEntityStatesChanged: (entityStates: HassEntity[]) => void
  ) {
    if (this.simulation.entities) {
      this.entities = this.entities.concat(this.simulation.entities);
    }

    if (this.simulation.entity) {
      this.entities = this.entities.concat(this.simulation.entity);
    }

    if (!this.entities.length) {
      console.error('Simulation must contain at least one entity', simulation);
    }

    if (!this.simulation.states?.length && !this.simulation.state) {
      console.error('Simulation must contain at least one state', simulation);
    }

    this.triggerState(this.simulation.state ?? this.simulation.states[0]);
  }

  triggerState(currentState: HassEntity | TimedHassEntity): void {
    if (this.simulation.enabled || this.simulation.enabled === undefined) {
      for (const entity of this.entities) {
        this.updateEntityState(entity, currentState);
      }
    }

    if (this.simulation.states) {
      const currentIndex = this.simulation.states.indexOf(currentState);
      const nextIndex = (currentIndex + 1) % this.simulation.states.length;
      const nextState = this.simulation.states[nextIndex];

      if ((nextState as TimedHassEntity)?.duration) {
        setTimeout(
          this.triggerState.bind(this),
          (currentState as TimedHassEntity).duration * 1000,
          nextState
        );
      }
    }
  }

  updateEntityState(
    entity: string | HassEntity,
    state: string | HassEntity
  ): void {
    const entityId =
      typeof entity === 'string' ? entity : (entity as HassEntity).entity_id;

    const existingHassState = this.hass.states[entityId];

    let newHassState: HassEntity;

    if (existingHassState) {
      // Clone the existing state
      newHassState = Object.assign({}, existingHassState);
      newHassState.attributes = Object.assign({}, existingHassState.attributes);
    } else {
      // Create a new state
      newHassState = new HassEntity();
      newHassState.entity_id = entityId;
    }

    // Assign the new state
    if (typeof state === 'string') {
      newHassState.state =
        typeof state === 'string' ? state : (state as HassEntity).state;
    } else if (typeof state === 'object') {
      newHassState.state = (state as HassEntity).state;

      if ((state as HassEntity).attributes) {
        newHassState.attributes = Object.assign(
          {},
          newHassState.attributes,
          (state as HassEntity).attributes
        );
      }
    }

    // Ensure the attributes object exists
    newHassState.attributes = newHassState.attributes ?? {};
    newHassState.attributes.friendly_name =
      newHassState.attributes?.friendly_name ?? entityId;

    // Update timestamps
    newHassState.last_changed = new Date().toString();
    newHassState.last_updated = new Date().toString();

    this.onEntityStatesChanged([newHassState]);
  }
}
