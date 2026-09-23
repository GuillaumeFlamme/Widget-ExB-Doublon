/** @jsx jsx */
import { React, jsx, type AllWidgetSettingProps } from 'jimu-core'
import { MapWidgetSelector } from 'jimu-ui/advanced/setting-components'
import { TextInput, Label } from 'jimu-ui'
import type { IMConfig } from '../config'

export default function Setting(props: AllWidgetSettingProps<IMConfig>) {
  const onMapWidgetSelected = (useMapWidgetIds: string[]) => {
    props.onSettingChange({ id: props.id, useMapWidgetIds })
  }

  const onFieldChange = (key: 'fieldName' | 'fieldValue', value: string) => {
    props.onSettingChange({
      id: props.id,
      config: props.config.set(key, value)
    })
  }

  return (
    <div className="p-3">
      <p><strong>Widget Carte associé</strong></p>
      <MapWidgetSelector useMapWidgetIds={props.useMapWidgetIds} onSelect={onMapWidgetSelected} />

      <div className="mt-3">
        <Label>Nom du champ à mettre à jour</Label>
        <TextInput
          value={props.config?.fieldName || 'Doublons'}
          onChange={(e) => onFieldChange('fieldName', e.target.value)}
        />
      </div>

      <div className="mt-3">
        <Label>Valeur à appliquer</Label>
        <TextInput
          value={props.config?.fieldValue || 'OUI'}
          onChange={(e) => onFieldChange('fieldValue', e.target.value)}
        />
      </div>
    </div>
  )
}
