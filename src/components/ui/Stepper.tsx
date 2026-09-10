import { Stepper as AstryxStepper } from "@astryxdesign/core/Stepper";
import { Step } from "@astryxdesign/core/Stepper";
export function Stepper({ steps, current, onStep }: { steps: string[]; current: number; onStep?: (i: number)=> void }) {
  return (
    <AstryxStepper activeStep={current} onStepClick={onStep}>
      {steps.map((s, idx) => (
        <Step key={s} step={idx} label={s} />
      ))}
    </AstryxStepper>
  );
}
