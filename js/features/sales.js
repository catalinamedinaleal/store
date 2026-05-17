'use strict';

import { State } from '../state.js';
import { toInt } from '../utils/format.js';

export function saleTotal(items = State.get().saleItems || []) {
  return (items || []).reduce((acc, it) => acc + (Math.max(1, toInt(it.qty)) * Math.max(0, toInt(it.unit_price))), 0);
}

export function setSaleItems(items) {
  State.setSaleItems(items || []);
}
