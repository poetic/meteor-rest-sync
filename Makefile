test: 
	VELOCITY_CI=1 VELOCITY_TEST_PACKAGES=1 meteor test-packages --driver-package velocity:html-reporter --release velocity:METEOR@1.1.0.3_1 --velocity ./
