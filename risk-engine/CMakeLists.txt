cmake_minimum_required(VERSION 3.16)
project(motion_risk_engine LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

add_library(motion_risk_core STATIC src/risk.cpp)
target_include_directories(motion_risk_core PUBLIC include)
if(NOT MSVC)
  target_compile_options(motion_risk_core PRIVATE -Wall -Wextra -Wpedantic)
endif()

enable_testing()
add_executable(test_risk tests/test_risk.cpp)
target_link_libraries(test_risk PRIVATE motion_risk_core)
add_test(NAME risk_engine COMMAND test_risk)

# Python module. Skipped (with a message) when pybind11 is not installed, so
# the C++ library and its tests still build on their own.
option(MOTION_BUILD_PYTHON "Build the motion_risk Python module" ON)
if(MOTION_BUILD_PYTHON)
  set(PYBIND11_FINDPYTHON ON)
  find_package(pybind11 CONFIG QUIET)
  if(pybind11_FOUND)
    pybind11_add_module(motion_risk bindings/python.cpp)
    target_link_libraries(motion_risk PRIVATE motion_risk_core)
    # Drop the module next to the service so `import motion_risk` just works.
    set_target_properties(motion_risk PROPERTIES
      LIBRARY_OUTPUT_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/service)
  else()
    message(STATUS "pybind11 not found: skipping the Python module "
                   "(pip install pybind11, then pass -Dpybind11_DIR=$(python -m pybind11 --cmakedir))")
  endif()
endif()
