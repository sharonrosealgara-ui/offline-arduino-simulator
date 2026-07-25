#include <Servo.h>

Servo classroomServo;

void setup() {
  classroomServo.attach(9);
}

void loop() {
  for (int angle = 0; angle <= 180; angle++) {
    classroomServo.write(angle);
    delay(15);
  }
  for (int angle = 180; angle >= 0; angle--) {
    classroomServo.write(angle);
    delay(15);
  }
}
